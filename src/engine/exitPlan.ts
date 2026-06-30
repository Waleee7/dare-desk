// The Exit Brain. Every fired signal carries one of these so Josh never has to ask
// "when do I get out?" — it answers hold-window, take-profit in PREMIUM % (what you
// actually trade), a premium-based stop, the runner trigger, and the invalidation.
//
// Philosophy = his June 29 tape: a base hit you bank fast (+~15%) and a runner you
// let cook on a breakout (+40%+). Two exits, one plan. Premiums are modeled off the
// delta/gamma estimate in contracts.ts until a live chain is wired.

import type { TradeIdea, FirewallResult, ExitPlan, PremiumExit } from '../lib/types.js';
import { estDelta, premiumAt, premiumPct } from '../scan/contracts.js';

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;
const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;

export function deriveExitPlan(idea: TradeIdea, fw: FirewallResult): ExitPlan {
  const horizon = idea.timeframe ?? 'intraday';
  const style: ExitPlan['style'] = horizon === 'scalp' ? 'scalp' : horizon === 'swing' ? 'swing' : 'runner';
  const entry = idea.entry;
  const entryPrem = idea.premium;
  const stop = fw.stop ?? idea.stop;
  const targets = fw.targets.length ? fw.targets : idea.targets;

  const window = HOLD[horizon];

  // No entry/premium (e.g. a parsed alert missing levels) → structural plan only.
  if (entry == null || entryPrem == null || entryPrem <= 0) {
    return {
      style, holdWindow: window.label, timeStopMin: window.timeStop,
      takeProfits: [], stop: bareStop(stop),
      trail: TRAIL[horizon], runnerTrigger: RUNNER[horizon],
      invalidation: stop != null ? `Lose ${money(stop)} → cut it, thesis dead.` : 'Define a stop before sizing in.',
    };
  }

  const dir = idea.direction;
  const delta = estDelta(horizon);
  const s = sign(dir);

  // TP1 = a quick "base hit" — a modest FIXED premium gain you bank fast (your real
  // tape: a +8% snip). TP2 = the structural target — the "let it cook" runner (+42%).
  const baseHitPct = horizon === 'scalp' ? 20 : horizon === 'intraday' ? 30 : 50;
  const tp1Prem = round(entryPrem * (1 + baseHitPct / 100));
  const tp1: PremiumExit = {
    label: 'TP1 · base hit', premium: tp1Prem, premiumPct: baseHitPct,
    underlying: round(entry + s * (tp1Prem - entryPrem) / delta),
    action: style === 'scalp' ? 'Sell 1/2–2/3 here, bank the green.' : 'Bank half, free-roll the rest.',
  };

  // Runner = the structural target; must beat the base hit or it's not a runner.
  const runnerTarget = targets[1] ?? targets[0] ?? entry + s * entry * 0.01;
  let tp2 = premExit('TP2 · runner', entry, runnerTarget, entryPrem, delta, horizon, true,
    'Let it cook — only the runner stays on.');
  if (tp2.premiumPct <= baseHitPct) {
    const p = round(entryPrem * (1 + (baseHitPct * 2) / 100));
    tp2 = { label: 'TP2 · runner', premium: p, premiumPct: baseHitPct * 2, underlying: round(entry + s * (p - entryPrem) / delta), action: 'Let it cook — only the runner stays on.' };
  }

  // Stop in premium terms — translate the underlying stop, but CAP the loss so a
  // cheap 0DTE never recommends bleeding half the premium (discipline > hope).
  const maxLossPct = horizon === 'scalp' ? 35 : horizon === 'intraday' ? 40 : 50;
  const capPrem = round(entryPrem * (1 - maxLossPct / 100));
  const stopUnderlying = stop ?? entry - s * Math.abs(runnerTarget - entry) / 2.6;
  const transPrem = premiumAt(entryPrem, delta, Math.abs(entry - stopUnderlying), horizon, false);
  const stopPrem = Math.max(capPrem, transPrem); // tighter loss wins
  const stopExit: PremiumExit = {
    label: 'Stop', premium: stopPrem, premiumPct: premiumPct(entryPrem, stopPrem),
    underlying: round(stopUnderlying), action: 'Cut it. No averaging down on 0DTE.',
  };

  return {
    style,
    holdWindow: window.label,
    timeStopMin: window.timeStop,
    takeProfits: [tp1, tp2],
    stop: stopExit,
    trail: TRAIL[horizon],
    runnerTrigger: `${RUNNER[horizon]} (clears ${money(round(runnerTarget))}) → ride for ${pctStr(tp2.premiumPct)}. No breakout = take the base hit.`,
    invalidation: `Stop ${pctStr(stopExit.premiumPct)} premium (loses ${money(round(stopUnderlying))})${horizon === 'scalp' ? ' or VWAP' : ''} → out now.`,
  };
}

function premExit(
  label: string, entry: number, level: number, entryPrem: number, delta: number,
  horizon: TradeIdea['timeframe'] & string, favorable: boolean, action: string,
): PremiumExit {
  const move = Math.abs(level - entry);
  const premium = premiumAt(entryPrem, delta, move, horizon ?? 'intraday', favorable);
  return { label, premium, premiumPct: premiumPct(entryPrem, premium), underlying: round(level), action };
}

function bareStop(stop: number | null): PremiumExit {
  return { label: 'Stop', premium: 0, premiumPct: 0, underlying: stop, action: 'Cut it. No averaging down.' };
}

const sign = (dir: 'long' | 'short') => (dir === 'long' ? 1 : -1);

const HOLD = {
  scalp: { label: 'Out in ~5–15 min (0DTE — theta bites fast)', timeStop: 20 },
  intraday: { label: '~30–90 min · flat by the close', timeStop: 120 },
  swing: { label: 'Hours to ~2 days · manage by level', timeStop: 0 },
} as const;

const TRAIL = {
  scalp: 'After TP1: trail the rest under the last 1m higher-low (calls) / lower-high (puts).',
  intraday: 'After TP1: trail under the 5m structure; give it room but protect green.',
  swing: 'After TP1: trail under the prior-day level or 15m structure.',
} as const;

const RUNNER = {
  scalp: 'Breaks the day-high on rising volume',
  intraday: 'Reclaims/breaks the session extreme on volume',
  swing: 'Closes through the level it broke',
} as const;
