// Contract selector + premium/delta model. Turns a raw setup (ticker, price,
// direction, horizon) into a REAL, tradeable contract: correct strike increment
// (TSLA trades $2.50-wide, not $1), a deliberate 0/3/7 DTE ladder, and an
// IV-aware premium estimate per name (TSLA premium ≫ SPY). The same delta model
// powers the Exit Brain's premium-based targets.
//
// HONEST NOTE: premiums/deltas here are MODELED (no live options chain yet — that's
// the paid data gap). They're calibrated to be realistic, not exact. When a chain
// feed is wired, swap estPremium/estDelta for the real bid/ask + greeks.

import type { OptionType, Timeframe } from '../lib/types.js';

// --- Strike increments (the grid each name's strikes actually print on) --------
const STRIKE_INCREMENT: Record<string, number> = {
  TSLA: 2.5, META: 5, NFLX: 5, AVGO: 5, MSFT: 2.5, AMZN: 2.5,
  // $1 grid: indices + sub-$150 names
  SPY: 1, QQQ: 1, IWM: 1, DIA: 1, SMH: 1, NVDA: 1, AMD: 1, MU: 0.5, AAPL: 1, GOOGL: 1,
};
export const strikeIncrement = (ticker: string): number => STRIKE_INCREMENT[ticker] ?? 1;

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const tidy = (n: number) => Math.round(n * 100) / 100;

/**
 * Pick the strike. Scalps (0DTE) lean slightly OTM — cheap, high-gamma, Josh's
 * actual style (he bought the 395C/397.5C OTM and the OTM one ran +42%). Intraday
 * and swing sit ATM for delta + a friendlier fill.
 */
export function selectStrike(ticker: string, price: number, type: OptionType, horizon: Timeframe): number {
  const step = strikeIncrement(ticker);
  const atm = roundTo(price, step);
  if (horizon !== 'scalp') return atm;
  // one increment out-of-the-money for the scalp
  return type === 'call' ? atm + step : atm - step;
}

// --- DTE ladder: 0 (scalp) / 3 (intraday) / 7 (swing) --------------------------
export const dteFor = (horizon: Timeframe): number => (horizon === 'scalp' ? 0 : horizon === 'intraday' ? 3 : 7);

/** Calendar DTE → an actual expiry date, rolled off weekends to a trading day. */
export function expiryForDte(dte: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + dte);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  if (day === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  else if (day === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  return d.toISOString().slice(0, 10);
}

// --- IV class → premium model --------------------------------------------------
type IvClass = 'ultra' | 'high' | 'low';
const ULTRA = new Set(['TSLA']);
const HIGH = new Set(['NVDA', 'AMD', 'META', 'MU', 'AVGO', 'SMH', 'NFLX']);
const ivClass = (ticker: string): IvClass => (ULTRA.has(ticker) ? 'ultra' : HIGH.has(ticker) ? 'high' : 'low');

// ATM premium ≈ price × factor. Factor rises with IV and with horizon (more time
// value). Tuned so TSLA 0DTE ATM lands ~$2.5–3.5 on a ~$395 stock — matching Josh's
// real $2.41–$2.74 fills — while SPY 0DTE stays ~$1–1.5.
const PREMIUM_FACTOR: Record<IvClass, Record<Timeframe, number>> = {
  ultra: { scalp: 0.0090, intraday: 0.0150, swing: 0.0230 },
  high: { scalp: 0.0065, intraday: 0.0110, swing: 0.0175 },
  low: { scalp: 0.0040, intraday: 0.0080, swing: 0.0140 },
};

/** Estimated ATM option premium ($/share) for the name + horizon. */
export function estPremium(ticker: string, price: number, horizon: Timeframe): number {
  const f = PREMIUM_FACTOR[ivClass(ticker)][horizon];
  // a slightly-OTM scalp is a touch cheaper than ATM
  const otmDiscount = horizon === 'scalp' ? 0.82 : 1;
  return Math.max(0.05, tidy(price * f * otmDiscount));
}

/** Estimated option delta (magnitude) for the chosen contract. */
export function estDelta(horizon: Timeframe): number {
  return horizon === 'scalp' ? 0.42 : horizon === 'intraday' ? 0.5 : 0.55;
}

/** Estimated gamma kicker — convexity that helps winners (0DTE moves fast ITM). */
const gammaFor = (horizon: Timeframe): number => (horizon === 'scalp' ? 0.022 : horizon === 'intraday' ? 0.012 : 0.006);

/**
 * Premium at a given underlying move. `favorable` = price moving toward the target
 * (premium up); otherwise toward the stop (premium down, theta-dominated — no gamma
 * help on losers). `move` is the |underlying $ distance|. delta+gamma model.
 */
export function premiumAt(entryPremium: number, delta: number, move: number, horizon: Timeframe, favorable: boolean): number {
  const g = gammaFor(horizon);
  if (favorable) return tidy(entryPremium + delta * move + 0.5 * g * move * move);
  return Math.max(0.01, tidy(entryPremium - delta * move));
}

/** Convenience: premium % change from entry. */
export const premiumPct = (entryPremium: number, premium: number): number =>
  Math.round(((premium - entryPremium) / entryPremium) * 100);
