(function (root) {
  'use strict';
  const demo = root.TraceDemoMarket;
  const symbols = ['SPY','QQQ','IWM','NVDA','MSFT','AMD','AAPL','TSLA'];
  let mode = 'live', securities = {}, news = {items:[],feeds:{}}, loading = false;
  let marketError = '', newsError = '', fetchedAt = null;
  function quote(symbol) {
    if (!symbols.includes(symbol)) throw new Error('Unknown symbol');
    if (mode === 'demo') return {...demo.quote(symbol),status:'demo',source:'固定模拟数据',quoteTime:null};
    const record = securities[symbol];
    if (!record || !record.data) return {symbol,name:symbol,last:null,previous:null,change:null,changePct:null,points:[],status:loading?'loading':'error',error:record?.error || marketError || '暂无数据'};
    return {...record.data,status:record.status,error:record.error};
  }
  function series(symbol, period) {
    if (period !== '1M' && period !== '3M') throw new Error('Unknown period');
    if (mode === 'demo') return demo.series(symbol,period);
    return quote(symbol).points.slice(period === '1M' ? -21 : -63);
  }
  function emit() { root.dispatchEvent(new CustomEvent('trace-data')); }
  async function request(url) {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),30000);
    try {
      const response = await fetch(url,{signal:controller.signal,cache:'no-store'});
      if (!response.ok) throw new Error('HTTP '+response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (loading || mode === 'demo') return;
    loading = true; emit();
    await Promise.allSettled([
      (async()=>{
        try {
          const data = await request('/api/market');
          if (!data.securities || !data.requestedAt) throw new Error('Invalid data');
          securities = data.securities; fetchedAt = data.requestedAt; marketError = '';
        } catch {
          marketError = '行情连接失败；请确认本地数据服务已启动';
          securities = Object.fromEntries(Object.entries(securities).map(([symbol,record])=>[symbol,{...record,status:record.data?'stale':'error',error:marketError}]));
        }
        emit();
      })(),
      (async()=>{
        try {
          const data = await request('/api/news');
          if (!Array.isArray(data.items) || !data.feeds) throw new Error('Invalid news');
          news = data; newsError = '';
        } catch {
          newsError = '新闻连接失败';
          news = {...news,items:news.items.map(item=>({...item,stale:true}))};
        }
        emit();
      })()
    ]);
    loading = false; emit();
  }
  const api = {
    quote,series,symbols,
    setMode(next) { if (!['live','demo'].includes(next)) return; mode=next; emit(); if(mode==='live')refresh(); },
    refresh,
    get mode(){return mode;},
    get loading(){return loading;},
    get news(){return news;},
    get newsError(){return newsError;},
    get marketError(){return marketError;},
    get fetchedAt(){return fetchedAt;},
  };
  root.TraceMarket = Object.freeze(api);
})(window);