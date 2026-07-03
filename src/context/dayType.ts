// Trend-day vs range-day classifier — TODAY'S character, not the daily chart.
// A breakout on a trend day is the trade; the same breakout on a range day is
// the trap. Reads SPY's session bars: range expansion vs the 10-day average
// (prorated by session progress) says trend; repeated VWAP crossings say chop.

import type { MarketDataProvider } from '../data/provider.js';
import type { MarketContext } from '../lib/types.js';
import { sessionBars } from '../scan/indicators.js';
import { etMinutes } from '../lib/clock.js';

export type DayType = NonNullable<MarketContext['dayType']>;

interface BarLike { o: number; h: number; l: number; c: number; v: number }

/** Count how many times price crossed the running session VWAP. Pure. */
export function vwapCrosses(bars: BarLike[]): number {
  let pv = 0;
  let vol = 0;
  let crosses = 0;
  let side: 1 | -1 | 0 = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    const vw = vol > 0 ? pv / vol : typical;
    const s: 1 | -1 = b.c >= vw ? 1 : -1;
    if (side !== 0 && s !== side) crosses++;
    side = s;
  }
  return crosses;
}

/** Classify from raw ingredients. Pure — unit-testable. */
export function classifyFrom(args: {
  sessionMin: number; // minutes since the 9:30 open
  todayRange: number; // session high - session low so far
  avgDailyRange: number; // 10-day average full-day range
  crosses: number; // VWAP crossings this session
  direction: 1 | -1 | 0; // price vs session open
}): DayType {
  const { sessionMin, todayRange, avgDailyRange, crosses, direction } = args;
  if (sessionMin < 30 || avgDailyRange <= 0) return 'forming';
  // Expected range grows ~sqrt(time in session) — compare apples to apples.
  const progress = Math.min(1, Math.max(0.1, sessionMin / 390));
  const expected = avgDailyRange * Math.sqrt(progress);
  const expansion = todayRange / expected;

  if (crosses > 4) return 'range'; // whipsawing the anchor = chop, whatever the range
  if (expansion >= 1.1 && direction !== 0) return direction > 0 ? 'trend-up' : 'trend-down';
  if (expansion < 0.7) return 'range'; // compressed tape — nothing to continue
  return sessionMin < 90 ? 'forming' : 'range';
}

/** Live classification off SPY. Never throws — degrades to 'forming'. */
export async function classifyDayType(provider: MarketDataProvider, now: Date = new Date()): Promise<DayType> {
  try {
    const [ones, daily] = await Promise.all([
      provider.getBars('SPY', '1Min', 390),
      provider.getBars('SPY', '1Day', 12),
    ]);
    const sess = sessionBars(ones, now);
    if (sess.length < 10) return 'forming';
    const todayRange = Math.max(...sess.map((b) => b.h)) - Math.min(...sess.map((b) => b.l));
    const prior = daily.slice(0, -1).slice(-10);
    const avgDailyRange = prior.length ? prior.reduce((s, b) => s + (b.h - b.l), 0) / prior.length : 0;
    const open = sess[0]!.o;
    const price = sess[sess.length - 1]!.c;
    const direction: 1 | -1 | 0 = price > open * 1.0008 ? 1 : price < open * 0.9992 ? -1 : 0;
    return classifyFrom({
      sessionMin: Math.max(0, etMinutes(now) - 570),
      todayRange,
      avgDailyRange,
      crosses: vwapCrosses(sess),
      direction,
    });
  } catch {
    return 'forming';
  }
}

/** Setup families for the day-type rules. */
export const CONTINUATION_SETUP = /breakout|breakdown|continuation|gap|momentum|prior-day|relative/i;
