// Shared SAMPLE data for the design-direction previews (/v/*). Realistic desk
// state so layouts can be judged with real content — clearly labeled preview.

export const sample = {
  dayPnl: 187.4,
  dayPnlPct: 1.87,
  peak: 242.0,
  tape: 'trend ↑',
  positionsOn: 2,
  proveIt: { done: 12, needed: 100 },
  openRisk: 168,
  positions: [
    {
      ticker: 'NVDA', side: 'CALLS', qty: '2x $142C 0DTE', grade: 'A+',
      plUsd: 152.3, plPct: 31, mark: 3.01, entry: 2.3, stop: 2.3, tp1: 2.99, tp2: 3.68,
      status: 'Runner on — TP1 banked, stop at breakeven', in: '10:12',
    },
    {
      ticker: 'SPY', side: 'PUTS', qty: '1x $618P 2DTE', grade: 'A',
      plUsd: -34.0, plPct: -8, mark: 3.86, entry: 4.2, stop: 2.73, tp1: 5.46, tp2: 6.72,
      status: 'Working — above stop, watching VWAP', in: '11:04',
    },
  ],
  talk: [
    { at: '11:42', msg: 'NVDA +24% — approaching TP1 $2.99. Looking to bank half there.' },
    { at: '11:44', msg: '💰 NVDA TP1 HIT +31% — sold 1x at ~$3.01, banked. Runner stays on, stop moved to BREAKEVEN.' },
    { at: '11:58', msg: 'SPY -8% — normal give-back, stop $2.73 not in danger. Holding.' },
  ],
  fired: [
    { ticker: 'NVDA', side: 'CALLS', setup: 'VWAP pullback continuation', grade: 'A+', conf: 92, contract: 'NVDA $142C 0DTE', entry: 141.8, stop: 140.9, tgt: '143.4 / 144.9', at: '10:12' },
  ],
  watching: [
    { ticker: 'TSLA', side: 'CALLS', setup: 'Range breakout', grade: 'B', conf: 76 },
    { ticker: 'QQQ', side: 'PUTS', setup: 'Failed breakout (liquidity sweep)', grade: 'B', conf: 72 },
  ],
  spark: [4, 9, 7, 12, 15, 13, 18, 22, 19, 26, 31, 28, 33, 30, 36, 41, 38, 45, 43, 48],
};

export type Sample = typeof sample;
