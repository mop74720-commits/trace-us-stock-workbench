from datetime import datetime
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from server import CachedResource, handler_for, normalize_chart, parse_news
from trace.intelligence.service import IntelligenceHub
from trace.intelligence.sources import Source


def stamp(day):
    return int(datetime.fromisoformat(day + 'T17:00:00+00:00').timestamp())


def fixture():
    return {'chart': {'result': [{
        'meta': {'symbol': 'NVDA', 'currency': 'USD', 'regularMarketTime': stamp('2026-09-17'),
                 'regularMarketPrice': 219.08, 'chartPreviousClose': 150},
        'timestamp': [stamp('2026-09-14'), stamp('2026-09-15'), stamp('2026-09-16'), stamp('2026-09-17')],
        'indicators': {'quote': [{'close': [None, 212.17, 213.9, 219.07]}]},
    }], 'error': None}}


class ChartTests(unittest.TestCase):
    def test_daily_change_uses_previous_trading_day_not_range_baseline(self):
        q = normalize_chart(fixture(), 'NVDA', '2026-09-17T17:01:00Z')
        self.assertEqual(q['previous'], 213.9)
        self.assertAlmostEqual(q['change'], 5.18)
        self.assertEqual(q['points'][-1]['close'], q['last'])
        self.assertEqual(len(q['points']), 3)
        self.assertEqual(q['points'][-1]['date'], '2026-09-17')

    def test_after_hours_quote_uses_previous_session_not_previous_calendar_day(self):
        d = fixture()
        d['chart']['result'][0]['meta']['regularMarketTime'] = stamp('2026-09-16')
        d['chart']['result'][0]['meta']['regularMarketPrice'] = 213.9
        q = normalize_chart(d, 'NVDA', 'now')
        self.assertEqual(q['previous'], 212.17)
        self.assertEqual(q['points'][-1]['date'], '2026-09-16')

    def test_invalid_symbol_currency_and_missing_history_rejected(self):
        for field, value in [('symbol', 'MSFT'), ('currency', 'EUR'), ('regularMarketPrice', float('nan'))]:
            d = fixture()
            d['chart']['result'][0]['meta'][field] = value
            with self.assertRaises(ValueError):
                normalize_chart(d, 'NVDA', 'now')
        d = fixture()
        d['chart']['result'][0]['indicators']['quote'][0]['close'] = [None] * 4
        with self.assertRaises(ValueError):
            normalize_chart(d, 'NVDA', 'now')


class CacheTests(unittest.TestCase):
    def test_cache_ttl_and_failed_refresh_preserve_timestamp_and_mark_stale(self):
        with patch('server.time.monotonic', return_value=100):
            resource = CachedResource(lambda: {'last': 219, 'fetchedAt': 'original'}, 60)
            self.assertEqual(resource.get()['status'], 'ok')
        resource.loader = lambda: (_ for _ in ()).throw(OSError('offline'))
        with patch('server.time.monotonic', return_value=110):
            self.assertEqual(resource.get()['status'], 'ok')
        with patch('server.time.monotonic', return_value=161):
            result = resource.get()
            self.assertEqual(result['status'], 'stale')
            self.assertEqual(result['data']['fetchedAt'], 'original')
            result['data']['last'] = 1
            self.assertEqual(resource.get()['data']['last'], 219)

    def test_cold_failure_has_no_fabricated_price(self):
        resource = CachedResource(lambda: (_ for _ in ()).throw(OSError('offline')), 60)
        self.assertEqual(resource.get()['status'], 'error')
        self.assertIsNone(resource.get()['data'])


class NewsTests(unittest.TestCase):
    def test_news_parses_dates_and_rejects_unsafe_links(self):
        xml = b'''<rss><channel>
        <item><title>A &amp; B</title><link>https://example.com/news</link><pubDate>Thu, 17 Sep 2026 17:30:00 +0000</pubDate></item>
        <item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Thu, 17 Sep 2026 17:30:00 +0000</pubDate></item>
        <item><title>Bad date</title><link>https://example.com/2</link><pubDate>invalid</pubDate></item>
        </channel></rss>'''
        result = parse_news(xml, 'NVDA', 'now')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['title'], 'A & B')
        self.assertEqual(result[0]['symbols'], ['NVDA'])
        self.assertTrue(result[0]['publishedAt'].endswith('+00:00'))


class IntelligenceServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        source=Source(id='news',name='News',kind='rss',url='https://example.org/rss',tier='T2',reliability=.8)
        self.hub=IntelligenceHub(Path(self.temp.name)/'intel.sqlite3',[source])
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.hub))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.hub.close()
        self.temp.cleanup()

    def get(self,path):
        return urllib.request.urlopen(self.base+path,timeout=2)

    def test_brief_has_no_market_payload(self):
        with self.get('/api/intelligence/brief?market=us') as response:
            brief=json.load(response)
        self.assertEqual(response.status,200)
        self.assertNotIn('market',brief)
        self.assertEqual(brief['evidence_policy'],'source_attributed_unverified')
        self.assertEqual(set(brief),{'as_of','summary','events','scope','context','evidence_policy'})

    def test_missing_evidence_and_invalid_filters_return_4xx(self):
        cases=[('/api/intelligence/evidence/missing',404),('/api/intelligence/feed?holdings=NVDA',400),
               ('/api/intelligence/feed?market=invalid',400),('/api/intelligence/digest?as_of=bad',400)]
        for path,status in cases:
            with self.subTest(path=path),self.assertRaises(urllib.error.HTTPError) as raised:
                self.get(path)
            self.assertEqual(raised.exception.code,status)

    def test_foreign_origin_cannot_request_collection(self):
        request=urllib.request.Request(self.base+'/api/intelligence/collect',data=b'{}',method='POST',
                                       headers={'Content-Type':'application/json','Origin':'http://evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request,timeout=2)
        self.assertEqual(raised.exception.code,403)


if __name__ == '__main__':
    unittest.main()
