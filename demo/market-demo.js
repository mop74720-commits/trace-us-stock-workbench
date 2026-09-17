(function (root) {
  'use strict';
  // Fixed synthetic samples: no requests, random values or live clock dependency.
  const shape = [94,94.8,94.2,95.4,96.1,95.7,96.6,96.2,95.4,94.7,95.1,96.4,97.2,96.7,97.8,98.2,97.4,96.8,97.5,98.8,99.1,98.5,99.4,98.9,100.3,101.2,100.7,99.8,100.5,101.8,101.1,102.3,101.6,100.4,101.2,102.1,103.4,102.8,103.1,104.2,103.7,102.4,103.2,104.5,105.3,104.4,103.5,104.1,105.7,106.4,105.6,106.9,107.2,106.1,105.4,106.3,107.6,108.2,107.5,108.6,107.9,109.2,110];
  const holidays = new Set(['2026-07-03', '2026-09-07']);
  const dates = [];
  for (let date = new Date('2026-09-17T12:00:00Z'); dates.length < shape.length; date.setUTCDate(date.getUTCDate() - 1)) {
    const day = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(day)) dates.unshift(day);
  }
  const definitions = [
    ['SPY', '标普 500 ETF', 578.24, 574.95, 0.28, 0],
    ['QQQ', '纳斯达克 100 ETF', 492.16, 487.38, 0.55, 2],
    ['IWM', '罗素 2000 ETF', 218.42, 219.35, 0.35, 4],
    ['NVDA', 'NVIDIA', 138, 135.42, 1, 1],
    ['MSFT', 'Microsoft', 445, 442.68, 0.42, 3],
    ['AMD', 'AMD', 164, 166.15, 1.2, 5],
    ['AAPL', 'Apple', 224, 222.76, 0.36, 2],
    ['TSLA', 'Tesla', 252, 257.63, 1.4, 6],
  ];
  const securities = Object.fromEntries(definitions.map(([symbol, name, last, previous, volatility, phase]) => {
    const raw = shape.map((value, i) => value + Math.sin((i + phase) * 0.85) * volatility);
    const closes = raw.map(value => Math.round(value / raw.at(-1) * last * 100) / 100);
    closes[closes.length - 2] = previous;
    closes[closes.length - 1] = last;
    return [symbol, Object.freeze({symbol, name, points: Object.freeze(closes.map((close, i) => Object.freeze({date: dates[i], close})))})];
  }));
  function quote(symbol) {
    const security = securities[symbol];
    if (!security) throw new Error('Unknown symbol');
    const last = security.points.at(-1).close;
    const previous = security.points.at(-2).close;
    return {...security, last, previous, change: last - previous, changePct: (last / previous - 1) * 100};
  }
  function series(symbol, period) {
    if (period !== '1M' && period !== '3M') throw new Error('Unknown period');
    return quote(symbol).points.slice(period === '1M' ? -21 : -63);
  }
  const api = Object.freeze({quote, series, symbols: Object.freeze(Object.keys(securities))});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraceDemoMarket = api;
})(typeof window !== 'undefined' ? window : globalThis);
