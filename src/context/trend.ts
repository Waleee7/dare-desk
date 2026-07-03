// Multi-timeframe trend engine — the "which way is this chart ACTUALLY going"
// layer. Reads 15m/1h/4h/1D bars and classifies each timeframe with the classic
// EMA9/EMA21 stack (price + fast EMA vs slow EMA), then rolls them into one
// alignment read. A trade fighting an aligned higher-timeframe stack is the
// classic 0/10 loser — the scorer penalizes it and the governor won't unlock
// the top of the range for it.

import type { MarketDataProvider, BarTimeframe } from '../data/provider.js';
import type { Direction, TrendDir, TrendLabel, TimeframeTrend, TrendSnapshot } from '../lib/types.js';
import { ema, rsi, last } from '../scan/indicators.js';

const TFS: { label: TrendLabel; tf: BarTimeframe; limit: number }[] = [
  { label: '15m', tf: '15Min', limit: 60 },
  { label: '1h', tf: '1Hour', limit: 60 },
  { label: '4h', tf: '4Hour', limit: 60 },
  { label: '1D', tf: '1Day', limit: 60 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Classify one timeframe: up = price above EMA9 above EMA21; down = the mirror.
 *  A dead-band on EMA separation keeps noise from printing as trend — if the
 *  EMAs are within 0.05% of each other the chart is chop, not direction. */
export function classifyTrend(closes: number[]): TimeframeTrend['dir'] {
  const price = last(closes);
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  if (price == null || fast == null || slow == null) return 'flat';
  if (slow !== 0 && Math.abs(fast - slow) / Math.abs(slow) < 0.0005) return 'flat';
  if (price > fast && fast > slow) return 'up';
  if (price < fast && fast < slow) return 'down';
  return 'flat';
}

function tfTrend(label: TrendLabel, closes: number[]): TimeframeTrend {
  const price = last(closes);
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  return {
    label,
    dir: classifyTrend(closes),
    emaFast: fast != null ? round2(fast) : null,
    emaSlow: slow != null ? round2(slow) : null,
    rsi: (() => { const r = rsi(closes); return r != null ? Math.round(r) : null; })(),
    pctFromEmaSlow: price != null && slow != null && slow !== 0
      ? round2(((price - slow) / slow) * 100)
      : null,
  };
}

/** Build the trend stack for a ticker. Never throws — a failed timeframe reads flat. */
export async function computeTrendSnapshot(
  provider: MarketDataProvider,
  ticker: string,
): Promise<TrendSnapshot> {
  const timeframes = await Promise.all(
    TFS.map(async ({ label, tf, limit }) => {
      const bars = await provider.getBars(ticker, tf, limit).catch(() => []);
      return tfTrend(label, bars.map((b) => b.c));
    }),
  );

  const ups = timeframes.filter((t) => t.dir === 'up').length;
  const downs = timeframes.filter((t) => t.dir === 'down').length;
  const alignScore = ups - downs;
  const alignment: TrendSnapshot['alignment'] =
    ups >= 3 && downs === 0 ? 'aligned-up' : downs >= 3 && ups === 0 ? 'aligned-down' : 'mixed';

  return { ticker, asOf: new Date().toISOString(), timeframes, alignment, alignScore };
}

/** Does the higher-timeframe stack back this direction? (≥2 TFs with it, none hard against.) */
export function htfAgrees(trend: TrendSnapshot, direction: Direction): boolean {
  const want: TrendDir = direction === 'long' ? 'up' : 'down';
  const against: TrendDir = direction === 'long' ? 'down' : 'up';
  const withMe = trend.timeframes.filter((t) => t.dir === want).length;
  const fighting = trend.timeframes.filter((t) => t.dir === against).length;
  return withMe >= 2 && fighting === 0;
}

/** Is the trade FIGHTING an aligned higher-timeframe stack? (The 0/10 pattern.) */
export function fightsHtf(trend: TrendSnapshot, direction: Direction): boolean {
  return (direction === 'long' && trend.alignment === 'aligned-down')
    || (direction === 'short' && trend.alignment === 'aligned-up');
}

/** Compact human string: "15m↑ 1h↑ 4h↑ 1D↓ · mixed". Used in alerts + LLM context. */
export function trendLine(trend: TrendSnapshot): string {
  const arrow = (d: TrendDir) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→');
  const tfs = trend.timeframes.map((t) => `${t.label}${arrow(t.dir)}`).join(' ');
  const tag = trend.alignment === 'aligned-up' ? 'ALIGNED UP'
    : trend.alignment === 'aligned-down' ? 'ALIGNED DOWN' : 'mixed';
  return `${tfs} · ${tag}`;
}
