// Pure technical indicators over bar arrays (oldest first). No lookahead — each
// reads only bars up to its index.

import type { Bar } from '../data/provider.js';
import { etMinutes } from '../lib/clock.js';

/**
 * Bars from TODAY'S regular session only (9:30 ET onward). Session-anchored
 * calculations — VWAP, session open, opening range, volume baselines — must
 * never see premarket or prior-day bars, or the anchor is a lie all morning.
 * Returns [] before the open; callers fall back to rolling bars when too thin.
 */
export function sessionBars(bars: Bar[], now: Date = new Date()): Bar[] {
  const minsSinceOpen = etMinutes(now) - 570; // 9:30 ET
  if (minsSinceOpen < 0) return [];
  const sessionStartMs = now.getTime() - minsSinceOpen * 60_000 - now.getSeconds() * 1000;
  return bars.filter((b) => b.t >= sessionStartMs - 30_000); // tolerance for bar-open stamps
}

export const last = <T>(a: T[]): T | undefined => a[a.length - 1];

export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i]!;
  return sum / n;
}

/** Exponential moving average of the last value (seeded with an SMA of the first n). */
export function ema(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i]!;
  e /= n;
  for (let i = n; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/** Wilder-style RSI over closes. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  const avgGain = gain / n, avgLoss = loss / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Session VWAP across the provided bars. */
export function vwap(bars: Bar[]): number | null {
  if (!bars.length) return null;
  let pv = 0, vol = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  return vol > 0 ? pv / vol : null;
}

/** Average True Range — for stop/target distance sizing. */
export function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i]!, prev = bars[i - 1]!;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c));
    sum += tr;
  }
  return sum / n;
}

export const pctChange = (from: number, to: number): number =>
  from === 0 ? 0 : ((to - from) / from) * 100;
