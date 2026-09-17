"""Local-only TRACE data gateway. Public market reads plus read-only intelligence."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import copy
import json
import math
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from trace.contracts.intelligence import build_intelligence_brief, parse_intelligence_query
from trace.intelligence.service import IntelligenceHub

SYMBOLS = ('SPY', 'QQQ', 'IWM', 'NVDA', 'MSFT', 'AMD', 'AAPL', 'TSLA')
NEWS_SYMBOLS = SYMBOLS[3:]
ET_ZONE = ZoneInfo('America/New_York')
SOURCE = 'Yahoo Finance'
USER_AGENT = 'Mozilla/5.0 (compatible; TraceLocalDemo/0.3)'


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def read_url(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json, application/xml, text/xml, */*'})
    with urllib.request.urlopen(request, timeout=10) as response:
        data = response.read(4_000_001)
        if len(data) > 4_000_000:
            raise ValueError('Response too large')
        return data


def normalize_chart(document, symbol, fetched_at):
    chart = document.get('chart', {})
    if chart.get('error') or not chart.get('result'):
        raise ValueError('行情源未返回可用数据')
    result = chart['result'][0]
    meta = result.get('meta', {})
    if meta.get('symbol') != symbol or meta.get('currency') != 'USD':
        raise ValueError('证券代码或币种不匹配')
    quote = result.get('indicators', {}).get('quote', [{}])[0]
    closes = quote.get('close', [])
    points_by_date = {}
    for timestamp, close in zip(result.get('timestamp', []), closes):
        if numeric(timestamp) and numeric(close) and close > 0:
            day = datetime.fromtimestamp(timestamp, ET_ZONE).date().isoformat()
            points_by_date[day] = {'date': day, 'close': round(close, 6)}
    quote_timestamp = meta.get('regularMarketTime')
    last = meta.get('regularMarketPrice')
    if not numeric(quote_timestamp) or not numeric(last) or last <= 0:
        raise ValueError('缺少有效报价或报价时间')
    quote_date = datetime.fromtimestamp(quote_timestamp, ET_ZONE).date().isoformat()
    points_by_date[quote_date] = {'date': quote_date, 'close': last}
    points = sorted((p for day, p in points_by_date.items() if day <= quote_date), key=lambda p: p['date'])
    previous_points = [p for p in points if p['date'] < quote_date]
    if not previous_points:
        raise ValueError('缺少前一交易日收盘价')
    previous = previous_points[-1]['close']
    regular = meta.get('currentTradingPeriod', {}).get('regular', {})
    now = time.time()
    start, end = regular.get('start'), regular.get('end')
    session = ('常规时段' if start <= now < end else '常规时段外') if numeric(start) and numeric(end) else '时段未知'
    return {
        'symbol': symbol, 'name': meta.get('shortName') or symbol,
        'currency': 'USD', 'exchange': meta.get('fullExchangeName') or meta.get('exchangeName'),
        'last': last, 'previous': previous, 'change': last - previous,
        'changePct': (last / previous - 1) * 100, 'points': points,
        'quoteTime': datetime.fromtimestamp(quote_timestamp, timezone.utc).isoformat(),
        'fetchedAt': fetched_at, 'session': session, 'timezone': 'America/New_York',
        'source': SOURCE, 'sourceUrl': f'https://finance.yahoo.com/quote/{symbol}/',
        'delayNotice': '可能延迟，非实时保证', 'priceBasis': '日线收盘 / 当日盘中价；非总回报序列',
    }


def fetch_chart(symbol):
    if symbol not in SYMBOLS:
        raise ValueError('Unsupported symbol')
    last_error = None
    for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
        try:
            url = f'https://{host}/v8/finance/chart/{symbol}?range=3mo&interval=1d&includePrePost=false'
            return normalize_chart(json.loads(read_url(url)), symbol, utc_now())
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError, OSError) as exc:
            last_error = exc
    raise ValueError('Yahoo 行情暂不可用') from last_error


def parse_news(xml_data, symbol, fetched_at):
    items = []
    for item in ET.fromstring(xml_data).findall('./channel/item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        parsed = urllib.parse.urlsplit(link)
        if not title or parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            continue
        try:
            date = parsedate_to_datetime(item.findtext('pubDate', '')).astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, AttributeError):
            continue
        items.append({'id': item.findtext('guid') or link, 'title': title[:600], 'url': link,
                      'publishedAt': date, 'fetchedAt': fetched_at, 'publisher': parsed.hostname,
                      'source': 'Yahoo Finance RSS', 'symbols': [symbol]})
    return items[:20]


def fetch_news(symbol):
    url = f'https://finance.yahoo.com/rss/headline?s={symbol}&region=US&lang=en-US'
    return {'items': parse_news(read_url(url), symbol, utc_now()), 'fetchedAt': utc_now()}


class CachedResource:
    """Per-resource lock prevents duplicate refreshes. Failed fetches retain labeled cache."""
    def __init__(self, loader, ttl):
        self.loader, self.ttl = loader, ttl
        self.value = None
        self.expires_at = 0
        self.error = None
        self.lock = threading.Lock()

    def get(self):
        with self.lock:
            now = time.monotonic()
            if now >= self.expires_at:
                try:
                    self.value = self.loader()
                    self.error = None
                    self.expires_at = time.monotonic() + self.ttl
                except Exception:
                    self.error = '数据源请求失败，请稍后重试'
                    self.expires_at = time.monotonic() + 30
            value = copy.deepcopy(self.value)
            return {'status': 'stale' if self.error and value is not None else 'error' if self.error else 'ok',
                    'data': value, 'error': self.error}


markets = {symbol: CachedResource(partial(fetch_chart, symbol), 60) for symbol in SYMBOLS}
feeds = {symbol: CachedResource(partial(fetch_news, symbol), 300) for symbol in NEWS_SYMBOLS}


def market_payload():
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(SYMBOLS, pool.map(lambda symbol: markets[symbol].get(), SYMBOLS)))
    return {'source': SOURCE, 'requestedAt': utc_now(), 'cacheSeconds': 60, 'securities': results}


def news_payload():
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = dict(zip(NEWS_SYMBOLS, pool.map(lambda symbol: feeds[symbol].get(), NEWS_SYMBOLS)))
    merged = {}
    for symbol, result in results.items():
        for item in (result['data'] or {}).get('items', []):
            key = item['id']
            if key not in merged:
                merged[key] = {**item, 'stale': result['status'] == 'stale'}
            else:
                merged[key]['symbols'] = sorted(set(merged[key]['symbols'] + [symbol]))
                merged[key]['stale'] = merged[key]['stale'] and result['status'] == 'stale'
    return {'source': 'Yahoo Finance RSS', 'requestedAt': utc_now(), 'cacheSeconds': 300,
            'feeds': {symbol: {'status': result['status'], 'error': result['error'],
                              'fetchedAt': (result['data'] or {}).get('fetchedAt')} for symbol, result in results.items()},
            'items': sorted(merged.values(), key=lambda item: item['publishedAt'], reverse=True)[:50]}


def handler_for(intelligence=None):
    class Handler(SimpleHTTPRequestHandler):
        intelligence_hub = intelligence

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, format, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            super().end_headers()

        def send_json(self, value, status=200):
            raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def intelligence_query(self, split):
            return parse_intelligence_query(urllib.parse.parse_qs(split.query, keep_blank_values=True))

        def do_GET(self):
            split=urllib.parse.urlsplit(self.path)
            path=split.path
            if path == '/api/health':
                self.send_json({'service': 'trace-data', 'source': SOURCE, 'symbols': SYMBOLS})
            elif path == '/api/market':
                self.send_json(market_payload())
            elif path == '/api/news':
                self.send_json(news_payload())
            elif path.startswith('/api/intelligence'):
                self.handle_intelligence_get(path, split)
            elif path.startswith('/api/'):
                self.send_json({'error': 'Not found'}, 404)
            elif path in ('/', '/index.html', '/styles.css', '/logic.js', '/market.js', '/market-demo.js', '/intelligence.js', '/app.js'):
                super().do_GET()
            else:
                self.send_error(404)

        def handle_intelligence_get(self, path, split):
            hub=self.intelligence_hub
            if hub is None:
                return self.send_json({'error':'Intelligence subsystem is disabled'},503)
            if path.startswith('/api/intelligence/evidence/'):
                identifier=path.rsplit('/',1)[-1]
                item=hub.evidence(identifier)
                return self.send_json(item) if item else self.send_json({'error':'Evidence not found'},404)
            try:
                parsed=self.intelligence_query(split)
                if path == '/api/intelligence/brief':
                    return self.send_json(build_intelligence_brief(hub,parsed))
                if path == '/api/intelligence/feed':
                    return self.send_json(hub.feed(parsed['as_of'],parsed['context'],mode=parsed['mode'],category=parsed['category'],
                                                   source_id=parsed['source_id'],query=parsed['query'],window=parsed['window'],
                                                   offset=parsed['offset'],limit=parsed['limit'],market=parsed['market'],
                                                   person=parsed['person'],origin=parsed['origin']))
                if path == '/api/intelligence/digest':
                    return self.send_json(hub.digest(parsed['as_of'],context=parsed['context']))
                if path == '/api/intelligence':
                    historical=parsed['as_of'] is not None
                    return self.send_json({'status':hub.status(parsed['as_of']),'digest':hub.digest(parsed['as_of'],context=parsed['context']),
                                           'notifications':[] if historical else hub.notifications(),
                                           'recent':[] if historical else hub.recent_evidence()})
                return self.send_json({'error':'Not found'},404)
            except (ValueError,TypeError):
                return self.send_json({'error':'Invalid intelligence query'},400)

        def valid_local_origin(self):
            host=self.headers.get('Host','')
            allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
            return host in allowed and self.headers.get('Origin','') == f'http://{host}'

        def do_POST(self):
            path=urllib.parse.urlsplit(self.path).path
            if path != '/api/intelligence/collect':
                return self.send_json({'error':'Not found'},404)
            if self.intelligence_hub is None:
                return self.send_json({'error':'Intelligence subsystem is disabled'},503)
            if not self.valid_local_origin():
                return self.send_json({'error':'Only same-origin local commands are accepted'},403)
            if self.headers.get('Content-Type') != 'application/json':
                return self.send_json({'error':'Use application/json'},415)
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<=length<=4096:
                    return self.send_json({'error':'Payload too large'},413)
                body=json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(body,dict):
                    raise ValueError('Expected object')
            except (ValueError,TypeError,json.JSONDecodeError):
                return self.send_json({'error':'Invalid JSON'},400)
            self.intelligence_hub.request_collection()
            return self.send_json({'ok':True})

    return Handler


Handler=handler_for(None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-intelligence', action='store_true', help='Disable public intelligence collection and APIs')
    parser.add_argument('--intel-config', type=Path, default=REPO_ROOT/'config'/'intelligence.sources.json')
    parser.add_argument('--intel-db', type=Path, default=REPO_ROOT/'data'/'intelligence.sqlite3')
    parser.add_argument('--enable-x-api', action='store_true', help='Explicitly enable configured X API reads; provider billing may apply')
    args = parser.parse_args()
    hub=None
    server=None
    try:
        if not args.no_intelligence:
            hub=IntelligenceHub.from_config(args.intel_db.resolve(),args.intel_config.resolve(),args.enable_x_api)
            hub.start()
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(hub))
        intelligence_state='disabled' if hub is None else 'enabled'
        print(f'TRACE http://127.0.0.1:{args.port} | Yahoo Finance | intelligence={intelligence_state} | local only', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None:
            server.server_close()
        if hub is not None:
            hub.close()


if __name__ == '__main__':
    main()
