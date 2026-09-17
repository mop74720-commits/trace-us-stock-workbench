'use strict';

const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  evidence: '<path d="M4 5h16v15H4zM8 9h8M8 13h8M8 17h5"/>',
  plans: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 5V3h6v2M8 11l2 2 5-5M8 17h8"/>',
  portfolio: '<path d="M12 3v9h9M8 4a9 9 0 1 0 12 12M16 3a9 9 0 0 1 5 5"/>',
  experiments: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const price = value => Number.isFinite(value) ? '$' + value.toFixed(2) : '—';
const signed = (value, digits = 2) => Number.isFinite(value) ? (value > 0 ? '+' : '') + value.toFixed(digits) : '—';
const direction = value => !Number.isFinite(value) ? 'muted' : value >= 0 ? 'positive' : 'negative';
const events = [
  {id:'nvda',ticker:'NVDA',company:'NVIDIA',type:'guidance',tag:'指引上调',time:'08:42',title:'全年收入指引：100–110 → 108–118 亿美元',summary:'指引中点上调 7.6%；一致预期暂无数据。',old:[100,110],next:[108,118],quote:'We now expect full-year revenue to be in the range of $10.8 billion to $11.8 billion, compared with our prior outlook of $10.0 billion to $11.0 billion.',counter:'一致预期暂无数据；应收账款增速待核实。',source:'公司 IR · 财报新闻稿',period:'FY2027 · 全年',entry:138,stop:130,sector:'半导体'},
  {id:'msft',ticker:'MSFT',company:'Microsoft',type:'earnings',tag:'财报',time:'08:15',title:'云业务收入同比 +24%，资本开支增加',summary:'自由现金流及资本开支回报周期待核实。',quote:'Cloud revenue grew 24% year over year. Capital expenditures increased as we continued to expand infrastructure capacity.',counter:'资本开支增幅和自由现金流数据尚未补齐。',source:'公司 IR · 季度业绩',period:'FY2027 · 第一季度',entry:445,stop:423,sector:'软件'},
  {id:'amd',ticker:'AMD',company:'AMD',type:'risk',tag:'待核实',time:'07:58',title:'供应链交付周期延长，尚无公司确认',summary:'仅有二手报道，未获得公司披露。',quote:'An unconfirmed industry report suggests that lead times may have extended for certain products.',counter:'缺少一手资料；交付范围与影响金额未知。',source:'媒体报道 · 未确认',period:'供应链事件',entry:164,stop:153,sector:'半导体'},
  {id:'aapl',ticker:'AAPL',company:'Apple',type:'earnings',tag:'财报',time:'07:31',title:'服务业务毛利率改善，硬件收入持平',summary:'分部现金流及一次性影响待核实。',quote:'Services gross margin improved, while product revenue remained broadly unchanged year over year.',counter:'缺少分部现金流；毛利率变化是否含一次性因素未知。',source:'公司 IR · 分部业绩',period:'FY2026 · 第四季度',entry:224,stop:212,sector:'消费科技'},
  {id:'tsla',ticker:'TSLA',company:'Tesla',type:'risk',tag:'利润率下降',time:'07:06',title:'交付量环比增加，汽车毛利率承压',summary:'价格与产品组合对单位利润的影响待核实。',quote:'Deliveries increased sequentially, while automotive gross margin was affected by pricing and product mix.',counter:'促销持续时间、单车利润及产品组合数据待补充。',source:'公司 IR · 经营更新',period:'季度经营事件',entry:252,stop:234,sector:'汽车'},
];
const positions = [
  {ticker:'MSFT',name:'Microsoft',sector:'软件',shares:30,price:TraceDemoMarket.quote('MSFT').last,cost:428},
  {ticker:'NVDA',name:'NVIDIA',sector:'半导体',shares:80,price:TraceDemoMarket.quote('NVDA').last,cost:132},
  {ticker:'AAPL',name:'Apple',sector:'消费科技',shares:40,price:TraceDemoMarket.quote('AAPL').last,cost:219},
];
let equity = 100000;
let invested = positions.reduce((sum, p) => sum + p.shares * p.price, 0);
const cash = 66650;
let accountReady = false;
let unrealized = positions.reduce((sum, p) => sum + p.shares * (p.price - p.cost), 0);
let storageAvailable = true;

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem('trace-demo-v1') || '{}') || {};
    return {
      watch: Array.isArray(raw.watch) ? [...new Set(raw.watch.filter(id => events.some(e => e.id === id)))] : ['nvda','msft','amd'],
      plans: Array.isArray(raw.plans) ? raw.plans.filter(p => p && events.some(e => e.id === p.eventId)
        && typeof p.id === 'string' && typeof p.note === 'string' && typeof p.status === 'string'
        && ['shares','entry','stop','value','weight','riskPct','created'].every(key => Number.isFinite(p[key]))) : [],
    };
  } catch {
    storageAvailable = false;
    return {watch:['nvda','msft','amd'],plans:[]};
  }
}

let state = readState();
let page = 'overview', filter = 'all', query = '', watchScope = 'watched', range = '20';
let selectedSymbol = events.find(e => e.id === state.watch[0])?.ticker || 'SPY';
let priceRange = '1M', chartIndex = null, toastTimer;
const pageNames = {overview:'总览',evidence:'自选股',plans:'交易计划',portfolio:'持仓',experiments:'回测'};
const main = document.getElementById('main');
const dialog = document.getElementById('detail');


function isLive() { return TraceMarket.mode === 'live'; }
function etTime(value, dateOnly = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'America/New_York',month:'2-digit',day:'2-digit',...(dateOnly ? {} : {hour:'2-digit',minute:'2-digit',hour12:false})}).format(date) + (dateOnly ? '' : ' ET');
}
function safeUrl(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? esc(url.href) : '#'; } catch { return '#'; }
}
function quoteStatus(q) {
  if (q.status === 'stale') return etTime(q.quoteTime) + ' · 旧缓存';
  if (q.status === 'loading') return '加载中';
  if (q.status === 'error') return '暂不可用';
  return isLive() ? etTime(q.quoteTime) : '模拟收盘';
}
function syncAccount() {
  accountReady = !isLive() || positions.every(p => TraceMarket.quote(p.ticker).status === 'ok');
  for (const p of positions) p.price = isLive() ? TraceMarket.quote(p.ticker).last : TraceDemoMarket.quote(p.ticker).last;
  invested = positions.every(p => Number.isFinite(p.price)) ? positions.reduce((sum,p)=>sum+p.shares*p.price,0) : null;
  equity = invested === null ? null : cash + invested;
  unrealized = invested === null ? null : positions.reduce((sum,p)=>sum+p.shares*(p.price-p.cost),0);
}
function dataStatus() {
  if (!isLive()) return '<div class="data-status warning">模拟模式：报价、公告、持仓和回测均为固定样本。</div>';
  const ok = TraceMarket.symbols.filter(symbol=>TraceMarket.quote(symbol).status === 'ok').length;
  const stale = TraceMarket.symbols.filter(symbol=>TraceMarket.quote(symbol).status === 'stale').length;
  const message = TraceMarket.loading ? '正在获取行情与新闻…' : ok === 8 ? '8 / 8 个标的已加载' : `${ok} / 8 个标的可用${stale ? `，${stale} 个使用旧缓存` : ''}`;
  return `<div class="data-status ${ok < 8 && !TraceMarket.loading ? 'warning' : ''}"><span><a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer">Yahoo Finance</a> · ${message} · 可能延迟，非实时保证</span><span>请求时间 ${etTime(TraceMarket.fetchedAt)} · 持仓数量 / 回测仍为演示</span></div>`;
}
function matchingNews(symbol) { return TraceMarket.news.items.filter(item=>item.symbols.includes(symbol)); }
function newsLinks(symbol) {
  const items = matchingNews(symbol).slice(0,8);
  return items.length ? `<div class="news-list">${items.map(item=>`<article><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)} ↗</a><span class="muted">${esc(item.publisher)} · ${etTime(item.publishedAt)}${item.stale ? ' · 旧缓存' : ''}</span></article>`).join('')}</div>` : `<div class="empty">${TraceMarket.loading ? '新闻加载中…' : '暂无可用新闻'}</div>`;
}

function persist() {
  try { localStorage.setItem('trace-demo-v1', JSON.stringify(state)); return true; }
  catch { storageAvailable = false; notify('无法写入浏览器存储，请导出记录'); return false; }
}
function notify(message) {
  const el = document.getElementById('toast');
  el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}
function navigate() {
  const target = location.hash.slice(1);
  page = Object.hasOwn(pageNames, target) ? target : 'overview';
  filter = 'all'; query = '';
  if (dialog.open) dialog.close();
  render();
}
function nav() {
  document.getElementById('nav').innerHTML = Object.entries(pageNames).map(([id, name]) => `<a href="#${id}" class="nav-item ${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${name}</span>${id === 'plans' && state.plans.length ? `<span class="nav-count">${state.plans.length}</span>` : ''}</a>`).join('');
}
function heading(title, action = '', description = '') {
  return `<div class="page-heading"><div><div class="heading-info"><h1>${title}</h1>${page === 'overview' ? `<span class="snapshot-label">${isLive() ? '美股 · 常规时段报价' : '09/17 16:00 ET · 示例收盘'}</span>` : ''}</div>${description ? `<p>${description}</p>` : ''}</div>${action}</div>`;
}
function panelHeader(title, right = '', count = '') {
  return `<div class="panel-header"><h2>${title}${count !== '' ? `<span class="count">${count}</span>` : ''}</h2>${right}</div>`;
}
function badge(e) { return `<span class="badge ${e.type === 'risk' ? 'warn' : e.type === 'guidance' ? 'up' : ''}">${e.tag}</span>`; }
function mark(e) { return `<span class="company-mark">${e.ticker[0]}</span>`; }
function watchButton(e) {
  const watched = state.watch.includes(e.id);
  return `<button class="watch-button ${watched ? 'on' : ''}" data-watch="${e.id}" aria-label="${watched ? '取消关注' : '关注'} ${e.ticker}" aria-pressed="${watched}">${watched ? '★' : '☆'}</button>`;
}
function spark(symbol, className = 'mini-spark') {
  const q = TraceMarket.quote(symbol), values = TraceMarket.series(symbol, '1M').map(p => p.close);
  if (values.length < 2) return '<span class="muted">—</span>';
  const min = Math.min(...values), max = Math.max(...values);
  const coords = values.map((v, i) => `${i * 74 / (values.length - 1)},${24 - (v - min) / (max - min || 1) * 22}`).join(' ');
  return `<svg class="${className}" viewBox="0 0 74 26" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="${q.change >= 0 ? '#11815c' : '#cb404b'}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
function marketStrip() {
  return `<div class="market-strip">${['SPY','QQQ','IWM'].map(symbol => {
    const q = TraceMarket.quote(symbol);
    return `<button class="market-tile ${selectedSymbol === symbol ? 'selected' : ''}" data-symbol="${symbol}" aria-label="查看 ${symbol} 行情"><span class="tile-label"><strong>${symbol}</strong><span class="muted">${esc(({SPY:"标普 500 ETF",QQQ:"纳斯达克 100 ETF",IWM:"罗素 2000 ETF"})[symbol] || q.name)}</span></span><span class="tile-bottom"><strong class="tile-price number">${Number.isFinite(q.last) ? q.last.toFixed(2) : '—'}</strong><span class="tile-change number ${direction(q.change)}">${signed(q.changePct)}%</span></span>${spark(symbol, 'tile-spark')}${isLive()?`<span class="quote-stamp">${quoteStatus(q)}</span>`:''}</button>`;
  }).join('')}<div class="market-tile cash"><div class="tile-label"><strong>模拟现金</strong><span class="muted">USD</span></div><div class="tile-bottom"><strong class="tile-price number">${money(cash)}</strong><span class="tile-change muted">${equity ? (cash / equity * 100).toFixed(2) + '%' : '待估值'}</span></div></div></div>`;
}

function lineChart(series, interactive = false) {
  const all = series.flatMap(s => s.values);
  const dataMin = Math.min(...all), dataMax = Math.max(...all);
  const pad = (dataMax - dataMin || 1) * .12, min = dataMin - pad, max = dataMax + pad;
  const coordinates = values => values.map((v, i) => `${(i * 800 / (values.length - 1)).toFixed(2)},${(200 - (v - min) / (max - min) * 200).toFixed(2)}`).join(' ');
  const first = coordinates(series[0].values);
  return `<div class="chart-layout"><div class="plot" ${interactive ? 'id="market-plot" tabindex="0" role="group" aria-label="价格图，使用左右方向键查看数据"' : ''}><svg class="price-chart" viewBox="0 0 800 200" preserveAspectRatio="none" role="img" aria-label="${interactive ? selectedSymbol + (isLive() ? ' Yahoo 日线价格' : ' 模拟收盘价') : 'A 与 B 模拟净值，非真实回测'}">${[0,50,100,150,200].map(y => `<line class="gridline" x1="0" y1="${y}" x2="800" y2="${y}"/>`).join('')}${interactive ? `<defs><linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2565d8" stop-opacity=".12"/><stop offset="100%" stop-color="#2565d8" stop-opacity=".01"/></linearGradient></defs><polygon points="0,200 ${first} 800,200" fill="url(#price-fill)"/>` : ''}${series.map(s => `<polyline class="price-line" points="${coordinates(s.values)}" style="stroke:${s.color}"/>`).join('')}</svg>${interactive ? '<div id="chart-cursor" class="chart-cursor" hidden></div><output id="chart-tooltip" class="chart-tooltip" hidden></output>' : ''}</div><div class="chart-axis number">${[0,1,2,3,4].map(i => `<span>${(max - i * (max - min) / 4).toFixed(2)}</span>`).join('')}</div></div>`;
}
function marketChart() {
  const q = TraceMarket.quote(selectedSymbol), points = TraceMarket.series(selectedSymbol, priceRange);
  const header = panelHeader('行情', `<div class="chips" aria-label="价格图周期">${['1M','3M'].map(period=>`<button class="chip ${priceRange===period?'active':''}" data-period="${period}" aria-pressed="${priceRange===period}">${period}</button>`).join('')}</div>`);
  if (!Number.isFinite(q.last) || points.length < 2) return header + `<div class="empty"><h3>${selectedSymbol} · ${q.status==='loading'?'加载中':'行情暂不可用'}</h3><p>${esc(q.error || '正在获取 Yahoo Finance 数据')}</p><button class="btn secondary" data-retry>重试</button></div>`;
  const values = points.map(p=>p.close), e = events.find(e=>e.ticker===selectedSymbol);
  return header + `<div class="quote-header"><div><div class="quote-title"><strong id="chart-symbol">${selectedSymbol}</strong><span class="muted">${esc(q.name)}</span>${e?`<button class="text-button" data-detail="${e.id}" aria-label="查看 ${selectedSymbol} 公司详情">详情 ↗</button>`:''}</div><div class="quote-price"><strong class="number" id="chart-price">${price(q.last)}</strong><span class="change number ${direction(q.change)}">${signed(q.change)} (${signed(q.changePct)}%)</span></div></div><div class="quote-meta"><span>${isLive()?'Yahoo Finance · USD · 可能延迟':'模拟收盘价 · USD'}</span><span>${quoteStatus(q)}</span></div></div><div class="price-chart-wrap">${lineChart([{values,color:'#2565d8'}],true)}<div class="chart-dates"><span>${points[0].date.slice(5).replace('-','/')}</span><span>${points[Math.floor(points.length/2)].date.slice(5).replace('-','/')}</span><span>${points.at(-1).date.slice(5).replace('-','/')}</span></div></div><div class="chart-footer"><span>区间最高<strong class="number">${price(Math.max(...values))}</strong></span><span>区间最低<strong class="number">${price(Math.min(...values))}</strong></span><span>昨收<strong class="number">${price(q.previous)}</strong></span>${isLive()?'<span>当日日线可能未收盘</span>':''}</div>`;
}

function selectSymbol(symbol) {
  if (!TraceMarket.symbols.includes(symbol)) return;
  selectedSymbol = symbol; chartIndex = null;
  document.getElementById('market-chart').innerHTML = marketChart();
  document.querySelectorAll('[data-symbol]').forEach(el => el.classList.toggle('selected', el.dataset.symbol === symbol));
}
function showChartPoint(index) {
  const points = TraceMarket.series(selectedSymbol, priceRange);
  chartIndex = Math.max(0, Math.min(points.length - 1, index));
  const point = points[chartIndex], tooltip = document.getElementById('chart-tooltip'), cursor = document.getElementById('chart-cursor');
  if (!tooltip || !cursor || !point) return;
  tooltip.textContent = `${point.date}　${price(point.close)}`;
  tooltip.hidden = false; cursor.hidden = false; cursor.style.left = `${chartIndex / (points.length - 1) * 100}%`;
}

function stockTable(items, compact = false) {
  if (!items.length) return `<div class="empty"><h3>${query ? '没有匹配的股票' : '暂无自选股'}</h3><p>${query ? '请尝试其他代码或公司名称。' : '在“全部股票”中点击星标添加。'}</p>${compact ? '<a href="#evidence">管理自选股 →</a>' : ''}</div>`;
  return `<div class="table-wrap"><table class="watch-table"><thead><tr>${compact ? '' : '<th>关注</th>'}<th>股票</th><th class="align-right">价格</th><th class="align-right">涨跌幅</th>${compact ? '<th class="spark-col">近 1 月</th>' : '<th>最新事项</th><th>操作</th>'}</tr></thead><tbody>${items.map(e => {
    const q = TraceMarket.quote(e.ticker);
    return `<tr class="select-row ${compact && selectedSymbol === e.ticker ? 'selected' : ''}" ${compact ? `data-symbol="${e.ticker}"` : `data-company="${e.id}"`}>${compact ? '' : `<td>${watchButton(e)}</td>`}<td><button class="row-button" ${compact ? `data-symbol="${e.ticker}" aria-label="查看 ${e.ticker} 行情"` : `data-detail="${e.id}" aria-label="查看 ${e.ticker} 公司详情"`}><span class="symbol-cell">${mark(e)}<span><strong>${e.ticker}</strong><small>${e.company}</small></span></span></button></td><td class="align-right number">${Number.isFinite(q.last) ? q.last.toFixed(2) : '—'}${isLive()?`<span class="quote-stamp">${quoteStatus(q)}</span>`:''}</td><td class="align-right number ${direction(q.change)}">${signed(q.changePct)}%</td>${compact ? `<td class="spark-col">${spark(e.ticker)}</td>` : `<td class="latest">${isLive()?esc(matchingNews(e.ticker)[0]?.title || '暂无新闻'):e.title}<div class="muted">${isLive()?'Yahoo RSS · 检索匹配':'09/17 '+e.time+' ET · 模拟公告'}</div></td><td><button class="text-button" data-plan="${e.id}">建计划</button></td>`}</tr>`;
  }).join('')}</tbody></table></div>`;
}
function announcementToolbar() {
  const choices = isLive() ? [['all','全部'],...state.watch.map(id=>{const e=events.find(e=>e.id===id);return [e.ticker,e.ticker];})] : [['all','全部'],['guidance','指引'],['earnings','财报'],['risk','风险']];
  return `<div class="toolbar"><div class="chips" aria-label="新闻筛选">${choices.map(([id,label])=>`<button class="chip ${filter===id?'active':''}" data-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><input class="search" id="news-search" aria-label="搜索公告" placeholder="搜索代码 / 标题" value="${esc(query)}"></div>`;
}

function filteredEvents() {
  const q = query.toLowerCase();
  return events.filter(e => (filter === 'all' || e.type === filter) && (!q || (e.ticker + e.company + e.title).toLowerCase().includes(q)));
}
function announcementList() {
  if (!isLive()) return filteredEvents().map(e=>`<article class="announcement"><time>${e.time}</time><span class="news-symbol">${e.ticker}</span><div><button class="text-button announcement-title" data-detail="${e.id}">${e.title}</button><small>${e.source}</small></div>${badge(e)}</article>`).join('') || '<div class="empty">没有匹配的公告</div>';
  const q=query.toLowerCase();
  const items=TraceMarket.news.items.filter(item=>(filter==='all'||item.symbols.includes(filter))&&(!q||(item.title+' '+item.symbols.join(' ')).toLowerCase().includes(q)));
  const failed=Object.values(TraceMarket.news.feeds).some(feed=>feed.status!=='ok');
  const warning = TraceMarket.newsError || (failed ? '部分新闻源更新失败' : '');
  return (warning ? `<div class="notice">${esc(warning)}，缓存内容已标记。</div>`:'') + (items.length ? items.map(item=>`<article class="announcement"><time>${etTime(item.publishedAt)}</time><span class="news-symbol">${item.symbols.join(' / ')}</span><div><a class="announcement-title" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)} ↗</a><small>${esc(item.publisher)}${item.stale?' · 旧缓存':''}</small></div></article>`).join('') : `<div class="empty">${TraceMarket.loading?'新闻加载中…':'暂无匹配的新闻'}</div>`);
}

function refreshAnnouncements() {
  document.getElementById('event-list').innerHTML = announcementList();
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === filter); b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
}
function pendingPlans() {
  const pending = state.plans.filter(p => p.status === '待人工确认');
  return panelHeader('待处理计划', '<a class="small" href="#plans">全部计划 →</a>', pending.length)
    + (pending.length ? pending.slice(-3).reverse().map(p => `<div class="pending-item"><div class="pending-head"><strong>${esc(events.find(e => e.id === p.eventId).ticker)}</strong><span class="badge blue">待人工确认</span></div><div class="pending-prices"><span>买入 <b class="number">${price(p.entry)}</b></span><span>失效 <b class="number">${price(p.stop)}</b></span><span class="number">${p.shares} 股</span></div><p>${esc(p.note || '未填写备注')}</p></div>`).join('')
      : '<div class="empty"><h3>暂无待处理计划</h3><p>从公司详情或自选股创建计划。</p><button class="btn secondary" data-plan="nvda">新建计划</button></div>')
    + '<div class="panel-footer"><span>计划仅保存在本地，不会下单</span></div>';
}
function overview() {
  return heading('市场总览', '<button class="btn secondary" data-plan="nvda">＋ 新建计划</button>') + dataStatus() + marketStrip()
    + `<div class="overview-top"><section class="panel" id="market-chart">${marketChart()}</section><section class="panel overview-watch">${panelHeader('自选股', '<a class="small" href="#evidence">管理 →</a>', state.watch.length)}${stockTable(state.watch.map(id => events.find(e => e.id === id)), true)}<div class="panel-footer"><span>点击股票切换左侧行情</span><span>USD</span></div></section></div>`
    + `<div class="overview-bottom"><section class="panel overview-news ${isLive()?'live-news':''}"><div class="panel-header news-header"><h2>${isLive()?'相关新闻':'最新公告'} <span class="muted">${isLive()?'Yahoo RSS · 检索匹配':'模拟'}</span></h2>${announcementToolbar()}</div><div id="event-list">${announcementList()}</div></section><section class="panel" id="pending-plans">${pendingPlans()}</section></div>`;
}
function watchItems() {
  const q = query.toLowerCase();
  return events.filter(e => (watchScope === 'all' || state.watch.includes(e.id)) && (!q || (e.ticker + e.company + e.title).toLowerCase().includes(q)));
}
function evidencePage() {
  return heading('自选股', '<button class="btn secondary" data-export>导出记录</button>')
    + dataStatus() + `<section class="panel"><div class="toolbar"><div class="chips">${[['watched','已关注'],['all','全部股票']].map(([id, label]) => `<button class="chip ${watchScope === id ? 'active' : ''}" data-scope="${id}" aria-pressed="${watchScope === id}">${label} ${id === 'watched' ? state.watch.length : events.length}</button>`).join('')}</div><input class="search" id="stock-search" aria-label="搜索公司或股票代码" placeholder="搜索代码 / 公司" value="${esc(query)}"></div><div id="stock-list">${stockTable(watchItems())}</div><div class="panel-footer"><span>点击股票行查看公司详情</span><span>${isLive()?'Yahoo Finance · USD · 可能延迟':'模拟收盘价 · USD'}</span></div></section>`;
}
function planTable() {
  if (!state.plans.length) return '<div class="empty"><h3>暂无交易计划</h3><p>设置参考买入价、失效价和风险预算后保存。</p><button class="btn" data-plan="nvda">新建计划</button></div>';
  return `<div class="table-wrap"><table class="plans-table"><thead><tr><th>标的 / 备注</th><th class="align-right">参考买入价</th><th class="align-right">失效价</th><th class="align-right">股数</th><th class="align-right">新增仓位</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${state.plans.slice().reverse().map(p => `<tr class="plan-row"><td><strong>${esc(events.find(e => e.id === p.eventId).ticker)}</strong><div class="muted">${p.marketContext?.mode==='live'?'真实报价 / 模拟账户':'原模拟计划'}</div><p class="plan-note">${esc(p.note || '—')}</p></td><td class="align-right number">${price(p.entry)}</td><td class="align-right number">${price(p.stop)}</td><td class="align-right number">${p.shares}</td><td class="align-right number">${p.weight.toFixed(2)}%</td><td><span class="badge ${p.status === '待人工确认' ? 'blue' : ''}">${esc(p.status)}</span></td><td class="small number">${esc(new Date(p.created).toLocaleString('zh-CN'))}</td><td>${p.status === '待人工确认' ? `<button class="text-button" data-archive="${esc(p.id)}">归档</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
function plansPage() {
  return heading('交易计划', '<div class="table-actions"><button class="btn secondary" data-export>导出记录</button><button class="btn" data-plan="nvda">＋ 新建计划</button></div>')
    + `<section class="panel">${panelHeader('计划列表', '<span class="muted">本地保存 · 未下单</span>', state.plans.length)}${planTable()}</section>`;
}
function accountStat(label, value, foot) {
  return `<div class="market-tile"><div class="tile-label">${label}</div><div class="tile-bottom"><strong class="tile-price number">${value}</strong></div><small>${foot}</small></div>`;
}
function exposure() {
  if (!equity) return '<p class="muted">等待持仓报价</p>';
  const entries=[...positions.map((p,i)=>({name:p.sector,value:p.shares*p.price,color:['#2565d8','#638fdb','#98b5e5'][i]})),{name:'现金',value:cash,color:'#e6ecf5'}];
  return `<div class="exposure-bar">${entries.map(e=>`<i style="width:${e.value/equity*100}%;background:${e.color}"></i>`).join('')}</div><div class="legend">${entries.map(e=>`<span style="--swatch:${e.color}">${e.name} ${(e.value/equity*100).toFixed(2)}%</span>`).join('')}</div>`;
}

function portfolioPage() {
  const title=heading('持仓','<span class="muted">模拟数量 / 成本 / 现金 · USD</span>');
  if (isLive() && !equity) return title + dataStatus() + '<div class="panel empty">行情未齐，暂无法计算示例账户估值。</div>';
  const loss=TraceMath.stressLoss(positions,10);
  return title + dataStatus() + `<div class="notice">${isLive()?'持仓数量与成本为演示样本，按真实报价估值。':'固定模拟账户。'}研究计划不会增加持仓。${!accountReady?'部分价格为旧缓存，暂不能新建计划。':''}</div><div class="account-strip">${accountStat('示例账户估值',money(equity),'现金 + 股票市值')}${accountStat('股票市值',money(invested),'3 只模拟持仓')}${accountStat('模拟现金',money(cash),'现金占比 '+(cash/equity*100).toFixed(2)+'%')}${accountStat('模拟未实现盈亏',`<span class="${direction(unrealized)}">${unrealized>=0?'+':''}${money(unrealized)}</span>`,'相对示例买入成本')}</div><div class="portfolio-grid"><section class="panel">${panelHeader('持仓明细',`<span class="muted">${isLive()?'真实报价 / 模拟持仓':'模拟持仓'}</span>`)}<div class="table-wrap"><table class="portfolio-table"><thead><tr><th>股票</th><th class="align-right">股数</th><th class="align-right">成本价</th><th class="align-right">现价</th><th class="align-right">市值 / 占比</th><th class="align-right">模拟盈亏</th></tr></thead><tbody>${positions.map(p=>`<tr><td><strong>${p.ticker}</strong><div class="muted">${p.sector}</div></td><td class="align-right number">${p.shares}</td><td class="align-right number">${price(p.cost)}</td><td class="align-right number">${price(p.price)}<span class="quote-stamp">${quoteStatus(TraceMarket.quote(p.ticker))}</span></td><td class="align-right number">${money(p.shares*p.price)}<div class="muted">${(p.shares*p.price/equity*100).toFixed(2)}%</div></td><td class="align-right number ${direction(p.price-p.cost)}">${p.price>=p.cost?'+':''}${money((p.price-p.cost)*p.shares)}</td></tr>`).join('')}</tbody></table></div><div class="panel-body"><h3>仓位分布</h3>${exposure()}<div class="risk-note"><b>集中度</b>${positions.filter(p=>p.shares*p.price/equity>.1).map(p=>p.ticker).join('、') || '无标的'}超过单股 10% 上限。三只股票均存在科技行业暴露。</div></div></section><section class="panel">${panelHeader('压力测试')}<div class="panel-body"><p class="experiment-description">股票同步下跌，现金价值不变。</p><label class="range-label" for="stress"><span>股票跌幅</span><strong class="number" id="stress-label">10%</strong></label><input type="range" id="stress" aria-label="股票跌幅" min="1" max="30" value="10" step="1"><div class="scenario-result number" id="stress-value">−${money(loss)}</div><p class="muted" id="stress-foot">占账户净值的 ${(loss/equity*100).toFixed(2)}%</p><div class="risk-note">未计入滑点和费用；跳空损失可能超过按失效价计算的金额。</div></div></section></div>`;
}

function experimentChart() {
  const b = [100,99.5,100.3,100.1,101.1,100.7,101.5,101.2,102.1,101.6,102.5,102.9,102.3,103.2,102.7,103.5,103.1,104.2,103.7,104.8];
  const a = [100,99.7,100.1,100.2,100.7,100.4,101,100.8,101.4,101,101.7,102,101.5,102.2,101.9,102.5,102.2,102.8,102.6,103.1];
  const count = Number(range);
  return lineChart([{values:a.slice(-count),color:'#8ba2bf'},{values:b.slice(-count),color:'#2565d8'}]) + `<div class="chart-dates"><span>第 ${21 - count} 个模拟日</span><span>第 20 个模拟日</span></div>`;
}
function experimentsPage() {
  return heading('回测', '<span class="badge warn">未运行真实回测</span>')
    + '<div class="notice">以下净值为虚构样本，仅展示对比方式。</div>'
    + `<div class="experiment-grid">${[['A','规则基线','固定股票池、执行时点、仓位和成本。'],['B','AI 筛选','在 A 的基础上增加指引变化分类，其他条件相同。'],['C','实际交易','尚未接入。单独记录成交、费用及人工调整。']].map(([id,title,desc]) => `<section class="panel"><div class="panel-body"><h3><span class="experiment-label">${id}</span>${title}</h3><p class="experiment-description section-gap">${desc}</p></div></section>`).join('')}</div>`
    + `<section class="panel">${panelHeader('收益对比', `<div class="chips">${['10','20'].map(n => `<button class="chip ${range === n ? 'active' : ''}" data-range="${n}" aria-pressed="${range === n}">${n} 个模拟日</button>`).join('')}</div>`)}<div id="experiment-chart" class="experiment-chart">${experimentChart()}</div><div class="panel-footer"><div class="legend"><span style="--swatch:#8ba2bf">A · 规则基线</span><span style="--swatch:#2565d8">B · AI 筛选</span></div><span>初始净值 100 · 模拟数据</span></div></section>`
    + `<section class="panel section-gap">${panelHeader('实验设置')}<div class="table-wrap"><table><thead><tr><th>策略版本</th><th>数据</th><th>AI 模型</th><th>回测引擎</th><th>验证方式</th></tr></thead><tbody><tr><td>guidance-filter / v0.1</td><td>固定虚构样本</td><td>未接入</td><td>未接入</td><td>待积累前向记录</td></tr></tbody></table></div></section>`;
}
function render() {
  syncAccount();
  document.getElementById('data-mode').value=TraceMarket.mode;
  document.getElementById('refresh-data').disabled=TraceMarket.loading || !isLive();
  document.getElementById('refresh-data').textContent=TraceMarket.loading?'加载中…':'刷新';
  document.getElementById('data-footer').textContent=isLive()?'Yahoo Finance · '+(TraceMarket.loading?'加载中':('请求 '+etTime(TraceMarket.fetchedAt))) : '固定模拟样本 · 2026-09-17';
  nav();
  main.innerHTML = ({overview,evidence:evidencePage,plans:plansPage,portfolio:portfolioPage,experiments:experimentsPage})[page]();
}

function openDialog(title, body, drawer = false) {
  dialog.classList.toggle('drawer', drawer);
  document.getElementById('dialog-content').innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function detail(id) {
  const e = events.find(e => e.id === id);
  if (!e) return;
  const q = TraceMarket.quote(e.ticker);
  if (isLive()) {
    openDialog('公司详情', `<div class="drawer-company">${mark(e)}<div><strong>${e.ticker}</strong><small>${e.company}</small></div>${watchButton(e)}<div class="drawer-quote"><strong class="number">${price(q.last)}</strong><div class="small number ${direction(q.change)}">${signed(q.changePct)}%</div></div></div><dl class="definition"><dt>来源</dt><dd><a href="${safeUrl(q.sourceUrl || 'https://finance.yahoo.com/quote/'+e.ticker+'/')}" target="_blank" rel="noopener noreferrer">Yahoo Finance ↗</a></dd><dt>报价时间</dt><dd>${quoteStatus(q)}</dd><dt>报价口径</dt><dd>常规时段最新价，可能延迟</dd><dt>一致预期</dt><dd>未接入</dd><dt>公司指引</dt><dd>未提取</dd></dl><h3>相关新闻</h3><p class="muted">按股票代码检索匹配；新闻标题不等于公司公告。</p>${newsLinks(e.ticker)}<div class="dialog-actions"><button class="btn secondary" data-close>关闭</button><button class="btn" data-plan="${e.id}">新建计划</button></div>`,true);
    return;
  }
  openDialog('公司详情', `<div class="drawer-company">${mark(e)}<div><strong>${e.ticker}</strong><small>${e.company}</small></div>${watchButton(e)}<div class="drawer-quote"><strong class="number">${price(q.last)}</strong><div class="small number ${direction(q.change)}">${signed(q.changePct)}%</div></div></div><h3>${e.title}</h3><div class="evidence-block"><div class="evidence-meta">模拟原文 · ${e.source}</div><blockquote>${e.quote}</blockquote></div><p>摘录为虚构样本，不是公司真实公告。</p>${e.old ? `<div class="guidance-compare"><div><small>原收入指引 / 亿美元</small><strong>${e.old.join('–')}</strong></div><span class="muted">→</span><div><small>新收入指引 / 亿美元</small><strong>${e.next.join('–')}</strong></div></div><p>中点变化：<strong class="positive">+${TraceMath.guidanceChange(...e.old,...e.next).toFixed(2)}%</strong>，相对前次公司指引。</p>` : ''}<dl class="definition"><dt>报告期</dt><dd>${e.period}（模拟）</dd><dt>发布时间</dt><dd>2026-09-17 07:00 ET</dd><dt>首次获取</dt><dd>2026-09-17 ${e.time} ET</dd><dt>一致预期</dt><dd>暂无数据</dd><dt>来源版本</dt><dd>demo-${e.id}-v1</dd></dl><div class="risk-note"><b>待核实</b>${e.counter}</div><div class="dialog-actions"><button class="btn secondary" data-close>关闭</button><button class="btn" data-plan="${e.id}">新建计划</button></div>`, true);
}
function plan(id) {
  const e = events.find(e => e.id === id) || events[0];
  const q=TraceMarket.quote(e.ticker);
  if (isLive() && (TraceMarket.loading || q.status!=='ok' || !accountReady)) { notify('请等待完整行情，缓存或失败状态不生成新计划'); return; }
  const entry=isLive()?q.last.toFixed(2):e.entry;
  const stop=isLive()?'':e.stop;
  openDialog('新建交易计划', `<form id="plan-form"><div class="form-grid"><label class="field">标的<select name="eventId" id="plan-ticker">${events.map(x => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${x.ticker} · ${x.company}</option>`).join('')}</select></label><label class="field">单笔风险预算 / 净值 %<input name="riskPct" type="number" step="0.1" min="0.1" max="5" value="0.5" required></label><label class="field">参考买入价 / USD<input name="entry" type="number" step="0.01" min="0.01" value="${entry}" required></label><label class="field">失效价 / USD<input name="stop" type="number" step="0.01" min="0.01" value="${stop}" placeholder="自行填写" required></label><label class="field field-wide">备注与失效条件<textarea name="note" maxlength="1200" placeholder="填写买入条件、待核实事项或取消计划的原因"></textarea></label></div><div id="plan-context" class="risk-note"><b>${isLive()?'报价来源':'待核实'}</b>${isLive()?'Yahoo Finance · '+quoteStatus(q)+'。失效价需自行填写。':e.counter}</div><div id="calculation" class="calc-output" aria-live="polite"></div><div id="form-error" class="form-error" role="alert"></div><p class="form-note">示例账户估值 ${money(equity)}，模拟现金 ${money(cash)}，单股总仓位上限 10%。按整股计算，扣除已有持仓；未执行计划不预占资金。未计入费用和跳空损失。</p><div class="dialog-actions"><button type="button" class="btn secondary" data-close>取消</button><button type="submit" class="btn" id="save-plan">保存计划</button></div></form>`);
  updateCalculation();
}
function planResult() {
  const form = document.getElementById('plan-form'), data = new FormData(form);
  const e = events.find(x => x.id === data.get('eventId'));
  if (isLive() && (TraceMarket.quote(e.ticker).status!=='ok' || !accountReady)) throw new Error('行情不可用，无法计算');
  if (!String(data.get('stop')).trim()) throw new Error('请填写失效价');
  const entry = Number(data.get('entry')), stop = Number(data.get('stop')), riskPct = Number(data.get('riskPct'));
  const result = TraceMath.positionSize({equity,cash,entry,stop,riskPct});
  const existing = positions.find(p => p.ticker === e.ticker);
  const existingValue = existing ? existing.shares * existing.price : 0;
  const remaining = Math.max(0, equity * .1 - existingValue);
  const shares = Math.min(result.shares, Math.floor(remaining / entry));
  return {...result,shares,value:shares * entry,plannedLoss:shares * (entry - stop),weight:shares * entry / equity * 100,limit:shares < result.shares ? '已有持仓占用单股上限' : result.limit,entry,stop,riskPct,eventId:e.id,note:String(data.get('note')).trim(),marketContext:{mode:TraceMarket.mode,source:TraceMarket.quote(e.ticker).source,quoteTime:TraceMarket.quote(e.ticker).quoteTime,price:TraceMarket.quote(e.ticker).last,accountEquity:equity,accountType:'simulated'}};
}
function updateCalculation() {
  try {
    const r = planResult();
    document.getElementById('calculation').innerHTML = `可新增 <strong>${r.shares}</strong> 股　/　${money(r.value)}<p>按失效价估算损失 ${money(r.plannedLoss)} · 新增仓位 ${r.weight.toFixed(2)}%</p><p>限制因素：${r.limit}</p>${r.shares === 0 ? '<p>无新增仓位空间，可保存为观察计划。</p>' : ''}`;
    document.getElementById('form-error').textContent = '';
    document.getElementById('save-plan').disabled = false;
  } catch (error) {
    document.getElementById('calculation').textContent = '参数无效，无法计算。';
    document.getElementById('form-error').textContent = error.message;
    document.getElementById('save-plan').disabled = true;
  }
}
function exportRecords() {
  const payload = {application:'TRACE demo',version:1,dataMode:isLive()?'real-market-simulated-account':'fictional-demo',marketSource:isLive()?'Yahoo Finance':'fixed-demo',exportedAt:new Date().toISOString(),watchlist:state.watch.map(id => events.find(e => e.id === id).ticker),plans:state.plans,notice:'持仓数量、成本与回测为演示；计划不是订单。真实行情模式使用 Yahoo Finance，可能延迟。未接入 AI 或券商。'};
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'trace-demo-research.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出 JSON');
}

document.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b) {
    const companyRow = event.target.closest('[data-company]'), symbolRow = event.target.closest('[data-symbol]');
    if (companyRow) detail(companyRow.dataset.company);
    else if (symbolRow && page === 'overview') selectSymbol(symbolRow.dataset.symbol);
    return;
  }
  if (b.hasAttribute('data-close')) dialog.close();
  else if (b.id==='refresh-data' || b.hasAttribute('data-retry')) TraceMarket.refresh();
  else if (b.dataset.detail) detail(b.dataset.detail);
  else if (b.dataset.plan) plan(b.dataset.plan);
  else if (b.dataset.symbol) selectSymbol(b.dataset.symbol);
  else if (b.dataset.period) { priceRange = b.dataset.period; selectSymbol(selectedSymbol); }
  else if (b.dataset.filter) { filter = b.dataset.filter; refreshAnnouncements(); }
  else if (b.dataset.scope) { watchScope = b.dataset.scope; render(); }
  else if (b.dataset.watch) {
    const id = b.dataset.watch;
    state.watch = state.watch.includes(id) ? state.watch.filter(x => x !== id) : [...state.watch,id];
    const saved = persist();
    render();
    const e = events.find(e => e.id === id);
    if (dialog.open && dialog.classList.contains('drawer')) {
      const star = dialog.querySelector('[data-watch]');
      if (star) star.outerHTML = watchButton(e);
      dialog.querySelector('[data-watch]')?.focus();
    }
    if (saved) notify(state.watch.includes(id) ? `已关注 ${e.ticker}` : `已取消关注 ${e.ticker}`);
  } else if (b.dataset.archive) {
    const p = state.plans.find(x => x.id === b.dataset.archive);
    if (p) { p.status = '已归档'; const saved = persist(); render(); if (saved) notify('已归档'); }
  } else if (b.dataset.range) { range = b.dataset.range; render(); }
  else if (b.hasAttribute('data-export')) exportRecords();
  else if (b.id === 'help') openDialog('使用说明', '<p>点击总览的自选股切换行情；在自选股页面点击股票行查看公司资料和新闻，点击星标添加或取消关注。</p><p>计划按模拟持仓和现金计算，保存在当前浏览器。归档不会删除记录，可导出 JSON。</p><p>真实模式使用 Yahoo Finance 报价、日线与 RSS 新闻，可能延迟；刷新最短间隔为行情 60 秒、新闻 5 分钟。失败时显示旧缓存或错误，不切回模拟价格。持仓数量、成本与回测仍为演示，未接入 AI 或券商。</p><div class="dialog-actions"><button class="btn" data-close>关闭</button></div>');
});
document.addEventListener('input', event => {
  if (event.target.id === 'news-search') { query = event.target.value; refreshAnnouncements(); }
  if (event.target.id === 'stock-search') { query = event.target.value; document.getElementById('stock-list').innerHTML = stockTable(watchItems()); }
  if (event.target.closest('#plan-form')) updateCalculation();
  if (event.target.id === 'stress') {
    const pct = Number(event.target.value), loss = TraceMath.stressLoss(positions,pct);
    document.getElementById('stress-label').textContent = pct + '%';
    document.getElementById('stress-value').textContent = '−' + money(loss);
    document.getElementById('stress-foot').textContent = '占账户净值的 ' + (loss / equity * 100).toFixed(2) + '%';
  }
});
document.addEventListener('change', event => {
  if (event.target.id==='data-mode') { filter='all'; query=''; TraceMarket.setMode(event.target.value); return; }
  if (event.target.id === 'plan-ticker') {
    const e = events.find(x => x.id === event.target.value), form = document.getElementById('plan-form');
    const q=TraceMarket.quote(e.ticker);
    form.elements.entry.value = isLive() && Number.isFinite(q.last) ? q.last.toFixed(2) : isLive() ? '' : e.entry;
    form.elements.stop.value = isLive() ? '' : e.stop;
    document.getElementById('plan-context').textContent = isLive() ? 'Yahoo Finance · '+quoteStatus(q)+'。失效价需自行填写。' : e.counter;
    updateCalculation();
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'plan-form') return;
  event.preventDefault();
  try {
    const result = planResult();
    state.plans.push({...result,id:'plan-' + Date.now() + '-' + Math.random().toString(16).slice(2,8),status:'待人工确认',created:Date.now(),dataMode:isLive()?'real-market-simulated-account':'fictional-demo'});
    const saved = persist(); dialog.close();
    if (location.hash === '#plans') { page = 'plans'; render(); } else location.hash = 'plans';
    if (saved) notify(result.shares ? '计划已保存 · 未下单' : '观察计划已保存 · 0 股');
  } catch (error) { document.getElementById('form-error').textContent = error.message; }
});
main.addEventListener('pointermove', event => {
  const plot = event.target.closest('#market-plot');
  if (!plot) return;
  const rect = plot.getBoundingClientRect(), points = TraceMarket.series(selectedSymbol,priceRange);
  showChartPoint(Math.round((event.clientX - rect.left) / rect.width * (points.length - 1)));
});
main.addEventListener('pointerout', event => {
  const plot = event.target.closest('#market-plot');
  if (!plot || plot.contains(event.relatedTarget)) return;
  const tooltip = document.getElementById('chart-tooltip'), cursor = document.getElementById('chart-cursor');
  if (tooltip) tooltip.hidden = true;
  if (cursor) cursor.hidden = true;
});
main.addEventListener('keydown', event => {
  if (event.target.id !== 'market-plot' || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const last = TraceMarket.series(selectedSymbol,priceRange).length - 1;
  showChartPoint((chartIndex ?? last) + (event.key === 'ArrowLeft' ? -1 : 1));
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); main.focus(); main.scrollIntoView({block:'start'}); });
window.addEventListener('hashchange', navigate);
window.addEventListener('trace-data', () => {
  if (dialog.open) return;
  const focused=document.activeElement, id=focused?.id, start=focused?.selectionStart, end=focused?.selectionEnd;
  render();
  if (id) { const replacement=document.getElementById(id); replacement?.focus(); if (typeof start==='number' && replacement?.setSelectionRange) replacement.setSelectionRange(start,end); }
});
dialog.addEventListener('close',()=>render());
navigate();
if (!storageAvailable) notify('本地存储不可用，请导出记录保存');

TraceMarket.refresh();
