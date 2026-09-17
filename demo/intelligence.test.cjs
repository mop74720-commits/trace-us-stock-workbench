const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function client(fetch) {
  const window = {dispatchEvent() {}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/intelligence.js','utf8'), {
    window, fetch, AbortController, setTimeout, clearTimeout, URLSearchParams,
    CustomEvent: class {},
  });
  return window.TraceIntelligence;
}

const brief={
  as_of:1788960000,
  summary:{selected_reports:1,related_reports:2,quotes:0,source_health:'healthy'},
  events:[{id:'1',title:'Nvidia earnings',verification:'unverified'}],
  scope:{market:'us'},context:{watchlist:['NVDA']},
  evidence_policy:'source_attributed_unverified'
};
const root={status:{health:'healthy',sources:[]},digest:{},notifications:[],recent:[]};

test('cold intelligence failure is isolated and leaves client settled', async()=>{
  const api=client(async()=>{throw new Error('offline');});
  await api.refresh();
  assert.equal(api.loading,false);
  assert.match(api.error,/情报/);
  assert.equal(api.brief,null);
});

test('valid brief and status are stored independently', async()=>{
  const api=client(async url=>({ok:true,json:async()=>url.includes('/brief')?brief:root}));
  await api.refresh();
  assert.equal(api.error,'');
  assert.equal(api.brief.events[0].id,'1');
  assert.equal(api.status.health,'healthy');
  assert.equal(api.filters.market,'us');
});

test('brief payload containing a market snapshot is rejected', async()=>{
  const api=client(async url=>({ok:true,json:async()=>url.includes('/brief')?{...brief,market:{mode:'synthetic'}}:root}));
  await api.refresh();
  assert.match(api.error,/情报/);
  assert.equal(api.brief,null);
});

test('filters are encoded and collection is a same-origin JSON post', async()=>{
  const calls=[];
  const api=client(async (url,options={})=>{
    calls.push([url,options]);
    return {ok:true,json:async()=>url.includes('/brief')?brief:url.includes('/collect')?{ok:true}:root};
  });
  api.setFilters({assets:'NVDA, MSFT',person:'musk',origin:'report'});
  await api.refresh();
  assert.ok(calls[0][0].includes('assets=NVDA%2C+MSFT'));
  await api.collect();
  const post=calls.find(([,options])=>options.method==='POST');
  assert.equal(post[0],'/api/intelligence/collect');
  assert.equal(post[1].headers['Content-Type'],'application/json');
  assert.equal(post[1].body,'{}');
});

test('verification formatter never upgrades unverified evidence',()=>{
  const api=client(async()=>{throw new Error('unused');});
  assert.equal(api.formatVerification('unverified'),'未核实');
  assert.equal(api.formatVerification('market_quote'),'市场报价');
  assert.equal(api.formatVerification('anything-else'),'状态未知');
});
