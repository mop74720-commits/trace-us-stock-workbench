const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const demo = require('./market-demo.js');

function client(fetch) {
  const window = {TraceDemoMarket:demo, dispatchEvent() {}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/market.js','utf8'),{window,fetch,AbortController,setTimeout,clearTimeout,CustomEvent:class {}});
  return window.TraceMarket;
}
const marketPayload = {requestedAt:'2026-09-17T17:00:00Z',securities:{NVDA:{status:'ok',error:null,data:{symbol:'NVDA',last:219,previous:214,change:5,changePct:2.33,quoteTime:'2026-09-17T17:00:00Z',points:[{date:'2026-09-16',close:214},{date:'2026-09-17',close:219}]}}}};

test('cold network failure leaves real quotes unavailable instead of demo fallback', async()=>{
  const api=client(async()=>{throw new Error('offline');});
  assert.equal(api.mode,'live');
  assert.equal(api.quote('NVDA').last,null);
  await api.refresh();
  assert.equal(api.quote('NVDA').status,'error');
  assert.equal(api.quote('NVDA').last,null);
  assert.equal(api.series('NVDA','1M').length,0);
  assert.equal(api.loading,false);
  api.setMode('demo');
  assert.equal(api.quote('NVDA').last,138);
});
test('failed refresh retains old real price and timestamp, labels news stale', async()=>{
  let offline=false;
  const api=client(async url=>{
    if(offline)throw new Error('offline');
    return {ok:true,json:async()=>url.endsWith('/market')?marketPayload:{feeds:{NVDA:{status:'ok'}},items:[{id:'1',title:'News'}]}};
  });
  await api.refresh();
  assert.equal(api.quote('NVDA').last,219);
  const timestamp=api.quote('NVDA').quoteTime;
  offline=true;
  await api.refresh();
  assert.equal(api.quote('NVDA').status,'stale');
  assert.equal(api.quote('NVDA').last,219);
  assert.equal(api.quote('NVDA').quoteTime,timestamp);
  assert.equal(api.news.items[0].stale,true);
});
