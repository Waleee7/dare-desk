// Multi-timeframe confirmation (Stage 2). Runs the setup detectors on 1m / 5m /
// 15m bars and checks directional agreement: more confirming timeframes = a
// stronger, longer-horizon trade; an opposing setup on another timeframe = a
// conflict (which the scorer/firewall push toward Watching). The set of
// confirming timeframes drives the trade horizon (scalp/intraday/swing) and,
// downstream, the contract-style / DTE recommendation.

import type { MarketDataProvider, BarTimeframe } from '../data/provider.js';
import type { Direction, Timeframe } from '../lib/types.js';
import { detectSetups, type SetupSignal } from './setups.js';
import { isIndex } from './universe.js';
import { last } from './indicators.js';

const TFS: { label: string; tf: BarTimeframe }[] = [
  { label: '1m', tf: '1Min' },
  { label: '5m', tf: '5Min' },
  { label: '15m', tf: '15Min' },
];

export interface MtfResult {
  primary: SetupSignal; // strongest setup across timeframes (its levels are used)
  price: number; // latest 1m close
  timeframes: string[]; // intervals confirming the primary direction, e.g. ['1m','5m']
  agreement: number; // count of confirming intervals (1-3)
  conflict: boolean; // an opposing-direction setup exists on another interval
  horizon: Timeframe; // scalp (1m only) → intraday (+5m) → swing (+15m)
}

export async function analyzeMtf(
  provider: MarketDataProvider,
  symbol: string,
  refReturnPct: number,
): Promise<MtfResult | null> {
  const daily = await provider.getBars(symbol, '1Day', 30);
  const per = await Promise.all(
    TFS.map(async (t) => ({ label: t.label, bars: await provider.getBars(symbol, t.tf, 60) })),
  );
  const idx = isIndex(symbol);
  const perSig = per.map((p) => ({ label: p.label, bars: p.bars, sigs: detectSetups(p.bars, daily, refReturnPct, { isIndex: idx }) }));

  // Strongest setup across all intervals = the candidate.
  let best: { label: string; sig: SetupSignal } | null = null;
  for (const { label, sigs } of perSig) {
    for (const s of sigs) if (!best || s.strength > best.sig.strength) best = { label, sig: s };
  }
  if (!best) return null;

  const dir: Direction = best.sig.direction;
  const timeframes = perSig.filter((p) => p.sigs.some((s) => s.direction === dir)).map((p) => p.label);
  const conflict = perSig.some((p) => p.sigs.some((s) => s.direction !== dir && s.strength >= 0.55));
  const horizon: Timeframe = timeframes.includes('15m') ? 'swing' : timeframes.includes('5m') ? 'intraday' : 'scalp';
  const oneMin = perSig.find((p) => p.label === '1m')?.bars ?? [];
  const price = last(oneMin)?.c ?? best.sig.entry;

  return { primary: best.sig, price, timeframes, agreement: timeframes.length, conflict, horizon };
}
