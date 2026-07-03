// Relative volume (RVOL) — is there real participation behind the move? A
// breakout on 0.6x volume is a trap; the same breakout on 2x volume is a trade.
// RVOL = today's cumulative volume vs the 20-day average, PRORATED by how far
// into the session we are (comparing a 10:15am partial day to full days would
// always read "dead"). Also surfaces a latest-bar surge read for the tape.

import type { MarketDataProvider } from '../data/provider.js';
import type { VolumeStats } from '../lib/types.js';
import { sma, last, sessionBars } from './indicators.js';
import { etMinutes, inMarketHours } from '../lib/clock.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const SESSION_MIN = 390; // 9:30 → 16:00 ET

/** Fraction of the trading session elapsed (0..1); 1 outside market hours. */
function sessionProgress(now = new Date()): number {
  if (!inMarketHours(now)) return 1;
  const m = etMinutes(now) - 570; // minutes since 9:30
  return Math.min(1, Math.max(0.05, m / SESSION_MIN)); // floor avoids silly 50x opens
}

/** Pure RVOL from daily bars (oldest first; last bar = today, possibly partial). */
export function rvolFromDaily(daily: { v: number }[], progress: number): number | null {
  if (daily.length < 6) return null;
  const today = last(daily)!.v;
  const prior = daily.slice(0, -1).slice(-20).map((b) => b.v);
  const avg = sma(prior, Math.min(20, prior.length));
  if (avg == null || avg <= 0) return null;
  return round2(today / (avg * progress));
}

/** Latest bar vs its own 20-bar average — the "conviction on the trigger" read. */
export function barSurge(bars: { v: number }[], mult = 1.3): boolean {
  if (bars.length < 21) return false;
  const recent = last(bars)!.v;
  const avg = sma(bars.slice(0, -1).map((b) => b.v), 20);
  return avg != null && avg > 0 && recent > avg * mult;
}

/** Live volume stats for a ticker. Never throws — degrades to nulls. */
export async function computeVolumeStats(
  provider: MarketDataProvider,
  ticker: string,
): Promise<VolumeStats> {
  const [daily, fives] = await Promise.all([
    provider.getBars(ticker, '1Day', 25).catch(() => []),
    provider.getBars(ticker, '5Min', 30).catch(() => []),
  ]);
  const rvol = rvolFromDaily(daily, sessionProgress());
  const sess = sessionBars(fives);
  const surge = barSurge(sess.length >= 21 ? sess : fives);
  const note = rvol == null ? 'RVOL unavailable'
    : rvol >= 1.5 ? `RVOL ${rvol}x — running HOT`
    : rvol >= 0.8 ? `RVOL ${rvol}x — normal tape`
    : `RVOL ${rvol}x — dead tape, breakouts suspect`;
  return { ticker, rvol, lastBarSurge: surge, note };
}
