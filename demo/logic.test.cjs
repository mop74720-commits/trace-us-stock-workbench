const test = require('node:test');
const assert = require('node:assert/strict');
const { guidanceChange, positionSize, stressLoss } = require('./logic.js');

test('guidance compares interval midpoints and rejects invalid periods/ranges', () => {
  assert.ok(Math.abs(guidanceChange(100, 110, 108, 118) - 7.619047619) < 1e-8);
  assert.throws(() => guidanceChange(110, 100, 108, 118));
  assert.throws(() => guidanceChange(0, 0, 1, 2));
});
test('position size obeys risk, concentration and cash limits with whole shares', () => {
  const base = { equity: 100000, cash: 66650, entry: 100, stop: 90, riskPct: .5 };
  assert.equal(positionSize(base).shares, 50);
  assert.equal(positionSize({...base, stop:99}).shares, 100);
  assert.equal(positionSize({...base, cash:249}).shares, 2);
  assert.equal(positionSize({...base, cash:0}).shares, 0);
  assert.throws(()=>positionSize({...base,stop:100}));
  assert.throws(()=>positionSize({...base,entry:NaN}));
  assert.throws(()=>positionSize({...base,riskPct:-1}));
});
test('stress applies to stock value only, not cash', () => {
  assert.equal(stressLoss([{shares:30,price:445},{shares:80,price:138},{shares:40,price:224}],10),3335);
  assert.equal(stressLoss([],10),0);
  assert.throws(()=>stressLoss([],101));
});
