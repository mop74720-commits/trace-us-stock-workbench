const test = require('node:test');
const assert = require('node:assert/strict');
const market = require('./market-demo.js');

test('both chart periods, quotes and daily changes share the same closing prices', () => {
  for (const symbol of market.symbols) {
    const quote = market.quote(symbol);
    const month = market.series(symbol,'1M'), quarter = market.series(symbol,'3M');
    assert.equal(month.length,21);
    assert.equal(quarter.length,63);
    assert.deepEqual(month,quarter.slice(-21));
    assert.equal(month.at(-1).close,quote.last);
    assert.equal(month.at(-2).close,quote.previous);
    assert.equal(quote.change,quote.last-quote.previous);
    assert.equal(quote.changePct,(quote.last/quote.previous-1)*100);
    assert.equal(month.at(-1).date,'2026-09-17');
    assert.ok(quarter.every((p,i)=>Number.isFinite(p.close)&&p.close>0&&(!i||p.date>quarter[i-1].date)));
  }
});
test('fixed sample endpoints match the existing portfolio and include declines', () => {
  assert.equal(market.quote('NVDA').last,138);
  assert.equal(market.quote('MSFT').last,445);
  assert.equal(market.quote('AAPL').last,224);
  assert.ok(market.quote('AMD').changePct<0);
  assert.ok(market.quote('IWM').changePct<0);
  assert.throws(()=>market.quote('INVALID'));
  assert.throws(()=>market.series('NVDA','1D'));
});
