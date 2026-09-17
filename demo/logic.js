(function (root) {
  'use strict';
  function guidanceChange(oldLow, oldHigh, newLow, newHigh) {
    const values = [oldLow, oldHigh, newLow, newHigh];
    if (!values.every(Number.isFinite) || oldLow > oldHigh || newLow > newHigh) throw new Error('指引区间无效');
    const base = (oldLow + oldHigh) / 2;
    if (base <= 0) throw new Error('原指引中点须为正数');
    return (((newLow + newHigh) / 2) / base - 1) * 100;
  }
  function positionSize({equity, cash, entry, stop, riskPct, maxPositionPct = 10}) {
    if (![equity, cash, entry, stop, riskPct, maxPositionPct].every(Number.isFinite)) throw new Error('请输入有效数字');
    if (equity <= 0 || cash < 0 || cash > equity || entry <= 0 || stop <= 0 || stop >= entry || riskPct <= 0 || riskPct > 5 || maxPositionPct <= 0 || maxPositionPct > 100) throw new Error('请检查价格与风险参数：失效价须低于参考买入价');
    const riskBudget = equity * riskPct / 100;
    const riskShares = Math.floor(riskBudget / (entry - stop));
    const capShares = Math.floor(equity * maxPositionPct / 100 / entry);
    const cashShares = Math.floor(cash / entry);
    const shares = Math.max(0, Math.min(riskShares, capShares, cashShares));
    return {shares, value: shares * entry, plannedLoss: shares * (entry - stop), riskBudget, weight: shares * entry / equity * 100, limit: shares === cashShares ? '可用现金' : shares === capShares ? '单股 10% 上限' : '单笔风险预算'};
  }
  function stressLoss(positions, dropPct) {
    if (!Number.isFinite(dropPct) || dropPct < 0 || dropPct > 100) throw new Error('情景跌幅无效');
    return positions.reduce((sum, p) => sum + p.shares * p.price, 0) * dropPct / 100;
  }
  const api = {guidanceChange, positionSize, stressLoss};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraceMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
