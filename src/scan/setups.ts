// Setup detectors — the cheap, deterministic pre-filter. They scan real-time
// bars for recognizable plays and emit candidate signals; only candidates that
// clear a strength floor get promoted to the (more expensive) LLM scoring.
// Index ETFs (SPY/QQQ/IWM/DIA/SMH) respect levels cleanly, so the level-based
// plays (prior-day break, gap-and-go, VWAP) get a specialist strength bump, and
// conviction volume on the trigger bar lifts every play.

import type { Bar } from '../data/provider.js';
import type { Direction, Timeframe } from '../lib/types.js';
import { rsi, vwap, atr, sma, last, pctChange } from './indicators.js';

export interface SetupSignal {
  setup: string;
  direction: Direction;
  timeframe: Timeframe;
  entry: number;
  stop: number;
  targets: number[];
  strength: number; // 0-1 prefilter confidence
  rationale: string;
}

export interface DetectOpts {
  isIndex?: boolean; // index ETF → level-based plays get a specialist bump
  isMomentum?: boolean; // high-IV mover (TSLA/NVDA…) → momentum/breakout plays bumped
}

const RR_T1 = 1.6; // first target at ~1.6R
const RR_T2 = 2.6;

function withRisk(entry: number, dir: Direction, risk: number, setup: string, timeframe: Timeframe, strength: number, rationale: string): SetupSignal {
  const sign = dir === 'long' ? 1 : -1;
  const stop = entry - sign * risk;
  return {
    setup, direction: dir, timeframe, entry, stop,
    targets: [round(entry + sign * risk * RR_T1), round(entry + sign * risk * RR_T2)],
    strength, rationale,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Did the latest bar print on conviction volume (> 1.3× the prior 20-bar avg)? */
function volumeSurge(bars: Bar[]): boolean {
  if (bars.length < 21) return false;
  const recent = last(bars)!.v;
  const avg = sma(bars.slice(0, -1).map((b) => b.v), 20);
  return avg != null && avg > 0 && recent > avg * 1.3;
}

/**
 * Detect setups on a symbol. `intraday` bars (1–5Min) drive scalp/intraday
 * setups; `daily` supplies prior-day levels; `refReturn` is SPY's recent % move
 * for relative-strength checks. `opts.isIndex` weights level plays up.
 */
export function detectSetups(intraday: Bar[], daily: Bar[], refReturnPct: number, opts: DetectOpts = {}): SetupSignal[] {
  const out: SetupSignal[] = [];
  if (intraday.length < 20) return out;

  const closes = intraday.map((b) => b.c);
  const price = last(closes)!;
  const prev = closes[closes.length - 2]!;
  const a = atr(intraday) ?? price * 0.002;
  const vw = vwap(intraday);
  const r = rsi(closes);
  const ma = sma(closes, 20);
  const lastBar = last(intraday)!;
  const surge = volumeSurge(intraday);

  // Conviction modifiers: index ETFs respect levels; momentum names get a bump on
  // trend plays; a volume surge confirms anything.
  const idxBump = opts.isIndex ? 0.05 : 0;
  const momBump = opts.isMomentum ? 0.05 : 0;
  const volBump = surge ? 0.06 : 0;
  const lift = (base: number) => Math.min(0.95, base + idxBump + momBump + volBump);
  const vtag = surge ? ' on a volume surge' : '';

  // Prior-day levels (from daily bars) — the lines indices pivot around.
  const pd = daily.length >= 2 ? daily[daily.length - 2] : undefined;
  const pdh = pd?.h ?? null;
  const pdl = pd?.l ?? null;
  const pdc = pd?.c ?? null;
  const sessionOpen = intraday[0]!.o;

  // 1) VWAP reclaim / reject (scalp) — crossed back through session VWAP.
  if (vw != null) {
    if (prev < vw && price >= vw) {
      out.push(withRisk(price, 'long', a * 1.2, 'VWAP reclaim', 'scalp', lift(0.62),
        `Reclaimed VWAP ${round(vw)} from below — intraday momentum flip up${vtag}.`));
    } else if (prev > vw && price <= vw) {
      out.push(withRisk(price, 'short', a * 1.2, 'VWAP reject', 'scalp', lift(0.6),
        `Lost VWAP ${round(vw)} from above — intraday momentum flip down${vtag}.`));
    }
  }

  // 2) RSI extreme turning (intraday).
  if (r != null) {
    if (r < 30 && price > prev) {
      out.push(withRisk(price, 'long', a * 1.5, 'RSI oversold reversal', 'intraday', 0.55,
        `RSI ${Math.round(r)} oversold and turning up.`));
    } else if (r > 70 && price < prev) {
      out.push(withRisk(price, 'short', a * 1.5, 'RSI overbought reversal', 'intraday', 0.53,
        `RSI ${Math.round(r)} overbought and rolling over.`));
    }
  }

  // 3) Opening-range / momentum breakout (intraday): break of the recent high.
  const window = intraday.slice(-15, -1);
  const hi = Math.max(...window.map((b) => b.h));
  const lo = Math.min(...window.map((b) => b.l));
  if (price > hi) {
    out.push(withRisk(price, 'long', a * 1.4, 'Range breakout', 'intraday', lift(0.58),
      `Broke the ${round(hi)} intraday range high on momentum${vtag}.`));
  } else if (price < lo) {
    out.push(withRisk(price, 'short', a * 1.4, 'Range breakdown', 'intraday', lift(0.56),
      `Lost the ${round(lo)} intraday range low${vtag}.`));
  }

  // 4) Relative strength vs SPY (swing lean): outperforming a flat/weak tape.
  const symReturn = pctChange(closes[Math.max(0, closes.length - 15)]!, price);
  if (ma != null && symReturn - refReturnPct > 0.4 && price > ma) {
    out.push(withRisk(price, 'long', a * 2, 'Relative strength', 'swing', 0.5,
      `Outperforming SPY by ${round(symReturn - refReturnPct)}% and holding above the 20MA.`));
  } else if (ma != null && refReturnPct - symReturn > 0.4 && price < ma) {
    out.push(withRisk(price, 'short', a * 2, 'Relative weakness', 'swing', 0.48,
      `Lagging SPY by ${round(refReturnPct - symReturn)}% and below the 20MA.`));
  }

  // 5) Gap-and-go: opened beyond the prior day's range and holding the side.
  if (pdh != null && pdc != null && sessionOpen > pdc * 1.002 && price >= sessionOpen && price > pdh) {
    out.push(withRisk(price, 'long', a * 1.3, 'Gap-and-go', 'intraday', lift(0.66),
      `Gapped over prior close ${round(pdc)} and holding above PDH ${round(pdh)}${vtag}.`));
  } else if (pdl != null && pdc != null && sessionOpen < pdc * 0.998 && price <= sessionOpen && price < pdl) {
    out.push(withRisk(price, 'short', a * 1.3, 'Gap-down continuation', 'intraday', lift(0.64),
      `Gapped below prior close ${round(pdc)} and losing PDL ${round(pdl)}${vtag}.`));
  }

  // 6) Prior-day high/low break — continuation through yesterday's extreme.
  if (pdh != null && prev <= pdh && price > pdh) {
    out.push(withRisk(price, 'long', a * 1.4, 'Prior-day high break', 'intraday', lift(0.64),
      `Broke prior-day high ${round(pdh)}${vtag} — continuation.`));
  } else if (pdl != null && prev >= pdl && price < pdl) {
    out.push(withRisk(price, 'short', a * 1.4, 'Prior-day low break', 'intraday', lift(0.62),
      `Lost prior-day low ${round(pdl)}${vtag} — breakdown.`));
  }

  // 7) Liquidity sweep / failed breakdown — wick through a swing level, snap back.
  const swWin = intraday.slice(-20, -1);
  const swingLo = Math.min(...swWin.map((b) => b.l));
  const swingHi = Math.max(...swWin.map((b) => b.h));
  if (lastBar.l < swingLo && lastBar.c > swingLo) {
    out.push(withRisk(lastBar.c, 'long', a * 1.3, 'Failed breakdown (liquidity sweep)', 'scalp', lift(0.66),
      `Swept the ${round(swingLo)} low then reclaimed — stop-run reversal up${vtag}.`));
  } else if (lastBar.h > swingHi && lastBar.c < swingHi) {
    out.push(withRisk(lastBar.c, 'short', a * 1.3, 'Failed breakout (liquidity sweep)', 'scalp', lift(0.64),
      `Swept the ${round(swingHi)} high then rejected — stop-run reversal down${vtag}.`));
  }

  // 8) VWAP pullback continuation — trend pulls back to VWAP and resumes.
  if (vw != null && ma != null) {
    const pulledToVwap = prev <= vw * 1.0015 && prev >= vw * 0.997; // prior bar tagged VWAP
    if (price > vw && price > ma && pulledToVwap && price > prev) {
      out.push(withRisk(price, 'long', a * 1.2, 'VWAP pullback continuation', 'intraday', lift(0.68),
        `Uptrend pulled back to VWAP ${round(vw)} and resumed${vtag}.`));
    } else if (price < vw && price < ma && pulledToVwap && price < prev) {
      out.push(withRisk(price, 'short', a * 1.2, 'VWAP rejection continuation', 'intraday', lift(0.66),
        `Downtrend popped to VWAP ${round(vw)} and rolled over${vtag}.`));
    }
  }

  // 9) Momentum continuation (0DTE gamma scalp) — the "name is ripping, ride it"
  // play. Price trending one way (above/below VWAP + 20MA) with a real intraday
  // push and (ideally) volume. Tight stop, fast scalp. Josh's bread-and-butter.
  const momRet = closes.length >= 10 ? pctChange(closes[closes.length - 10]!, price) : 0;
  if (vw != null && ma != null) {
    const trendUp = price > vw && price > ma && momRet > 0.25 && (r == null || (r > 52 && r < 80));
    const trendDn = price < vw && price < ma && momRet < -0.25 && (r == null || (r < 48 && r > 20));
    if (trendUp) {
      out.push(withRisk(price, 'long', a * 1.1, 'Momentum continuation (0DTE)', 'scalp', lift(0.7),
        `Ripping up — above VWAP ${round(vw)} & 20MA, +${round(momRet)}% push${vtag}. Gamma scalp.`));
    } else if (trendDn) {
      out.push(withRisk(price, 'short', a * 1.1, 'Momentum continuation (0DTE)', 'scalp', lift(0.7),
        `Bleeding down — below VWAP ${round(vw)} & 20MA, ${round(momRet)}% push${vtag}. Gamma scalp.`));
    }
  }

  return out;
}
