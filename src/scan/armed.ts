// ARMED — the pre-trigger heads-up. The scanner fires AFTER a setup confirms
// (the move already started); this catches the STRONGEST plays while they're
// still coiling AT the trigger, so you're positioned before the break instead of
// chasing a trade that's already gone. Deliberately strict — strongest only, not
// a firehose: a stacked higher-timeframe trend, hot participation, agreeing
// options flow, and price right against the level whose break confirms the trade.

import type { ArmedSignal, KeyLevels, TrendSnapshot, VolumeStats, Direction } from '../lib/types.js';
import { config } from '../lib/config.js';
import { etTimeString } from '../lib/clock.js';

export interface ArmedInput {
  ticker: string;
  price: number | null;
  trend: TrendSnapshot | null | undefined;
  levels: KeyLevels | null | undefined;
  rvol: VolumeStats | null | undefined;
  // Only the flow bias is read — both the full ChainSnapshot and the dashboard's
  // lite chain satisfy this, so armed detection reuses whatever intel is at hand.
  chain: { netFlowBias: 'bullish' | 'bearish' | 'mixed' } | null | undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Is this name a strongest-play ARM right now? Returns the signal, or null.
 * ALL of these must hold (that's what makes it "strongest only"):
 *   1. the higher-TF stack is aligned (not mixed) — we only pre-arm WITH the trend
 *   2. participation is hot (RVOL >= armMinRvol) — real fuel behind the move
 *   3. options flow agrees with the direction (or is at least not against it)
 *   4. price is within armProximityPct of the nearest trigger level in that
 *      direction (resistance for longs, support for shorts) — right at the break
 */
export function detectArmed(inp: ArmedInput, now: Date = new Date()): ArmedSignal | null {
  const { ticker, price, trend, levels, rvol, chain } = inp;
  if (price == null || !trend || !levels || rvol?.rvol == null) return null;

  // 1) Only pre-arm with a stacked higher-timeframe trend.
  if (trend.alignment === 'mixed') return null;
  const direction: Direction = trend.alignment === 'aligned-up' ? 'long' : 'short';

  // 2) Participation must be running hot.
  if (rvol.rvol < config.risk.armMinRvol) return null;

  // 3) Options flow must not fight the trade (agreeing is ideal; mixed is allowed).
  const flow = chain?.netFlowBias ?? null;
  if (direction === 'long' && flow === 'bearish') return null;
  if (direction === 'short' && flow === 'bullish') return null;

  // 4) Nearest trigger in the break direction, and price right up against it.
  const trigger = direction === 'long'
    ? [...levels.resistance].filter((l) => l > price).sort((a, b) => a - b)[0]
    : [...levels.support].filter((l) => l < price).sort((a, b) => b - a)[0];
  if (trigger == null) return null;
  const distancePct = round2((Math.abs(trigger - price) / price) * 100);
  if (distancePct > config.risk.armProximityPct) return null;

  const side = direction === 'long' ? 'CALLS' : 'PUTS';
  const flowNote = flow && flow !== 'mixed' ? `, flow ${flow}` : '';
  const why = `${trend.alignment === 'aligned-up' ? 'HTF stacked ↑' : 'HTF stacked ↓'} · RVOL ${rvol.rvol}x${flowNote} · `
    + `${distancePct}% from the ${trigger} trigger. Break ${trigger} = ${side.toLowerCase()} — get ready.`;

  return {
    ticker, direction, triggerLevel: trigger, price: round2(price),
    distancePct, rvol: rvol.rvol, flowBias: flow, alignment: trend.alignment,
    why, etTime: etTimeString(now),
  };
}

/** Discord-ready one-liner for an ARMED heads-up. */
export function renderArmed(a: ArmedSignal): string {
  const side = a.direction === 'long' ? 'CALLS' : 'PUTS';
  return `⚡ **ARMED — ${a.ticker} ${side}** · ${a.why}`;
}

/** Stable dedup key: same name+direction+level shouldn't re-arm every scan. */
export function armedKey(a: ArmedSignal): string {
  return `${a.ticker}:${a.direction}:${Math.round(a.triggerLevel * 20)}`;
}
