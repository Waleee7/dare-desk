// Component 4 — Risk Discipline Firewall. Hard blocks + position sizing + the
// daily-loss / cooldown / overtrading governors. Nothing reaches a broker
// without passing here. A governor REJECT is honored as a hard block.

import type {
  TradeIdea, GovernorDecision, FirewallResult, DayState, FactorScore,
} from '../lib/types.js';
import { config, clusterOf } from '../lib/config.js';
import { inLunchWindow, etMinutes } from '../lib/clock.js';
import { rewardRisk } from '../scoring/index.js';
import { thetaBleed } from '../scan/contracts.js';

export function runFirewall(
  idea: TradeIdea,
  decision: GovernorDecision,
  day: DayState,
  now = Date.now(),
  currentPrice?: number,
): FirewallResult {
  const r = config.risk;
  const blocks: string[] = [];
  const warnings: string[] = [];
  const flags = new Set<string>(
    (Object.values(decision.breakdown.factors) as FactorScore[]).flatMap((f) => f.flags),
  );

  // --- Hard blocks ---
  // C/D are watch-only / no-trade — never reach a broker. (A/A+ fire, B = watch-tracked.)
  if (decision.grade === 'D' || decision.grade === 'C') {
    blocks.push(`grade_${decision.grade} — not tradeable (watch/no-trade)`);
  }
  if (idea.stop == null) blocks.push('no_clear_stop');
  if (flags.has('wide_spread')) blocks.push('spread_too_wide');

  // Direct spread gate on the REAL chain quote (when the contract is chain-anchored).
  // A good stock setup with an untradeable contract is still a bad trade.
  const c = idea.contract;
  if (c.bid != null && c.ask != null && c.ask > 0) {
    const mid = (c.bid + c.ask) / 2;
    const spreadPct = mid > 0 ? ((c.ask - c.bid) / mid) * 100 : 999;
    if (spreadPct > r.maxSpreadPct) {
      blocks.push(`spread_too_wide (${spreadPct.toFixed(1)}% > ${r.maxSpreadPct}% at the ${c.strike} strike)`);
    }
  }

  // Theta budget — if the modeled decay over the PLANNED hold eats more than
  // config.thetaBudgetPct of the TP1 gain, the clock beats the trade before it starts.
  if (idea.premium != null && idea.premium > 0) {
    const horizon = idea.timeframe ?? 'intraday';
    const plannedHoldMin = horizon === 'scalp' ? 20 : horizon === 'intraday' ? 120 : 390;
    const minsToClose = Math.max(15, Math.min(390, 960 - etMinutes(new Date(now))));
    const bleed = thetaBleed(idea.premium, horizon, c.dte ?? 1, plannedHoldMin, minsToClose);
    const tp1Pct = horizon === 'scalp' ? 20 : horizon === 'intraday' ? 30 : 50;
    const tp1Gain = (idea.premium * tp1Pct) / 100;
    if (tp1Gain > 0 && bleed > (r.thetaBudgetPct / 100) * tp1Gain) {
      blocks.push(`theta_budget (~$${bleed.toFixed(2)} decay over ${plannedHoldMin}m eats >${r.thetaBudgetPct}% of the TP1 gain)`);
    }
  }

  // 0DTE gamma windows — same-day premium only where gamma and movement coexist
  // (open drive + power hour). A 13:45 0DTE into dead drift is a structural loser.
  if (c.dte === 0 && config.risk.zeroDteWindows.length) {
    const m = etMinutes(new Date(now));
    const inWindow = config.risk.zeroDteWindows.some((w) => m >= w.startMin && m < w.endMin);
    if (!inWindow && m >= 570 && m < 960) {
      blocks.push('0dte_outside_gamma_window (open drive + power hour only)');
    }
  }

  const rr = rewardRisk(idea);
  if (rr != null && rr < r.minRewardRisk) blocks.push(`reward_risk ${rr.toFixed(2)} < ${r.minRewardRisk}`);

  // Extended-universe bar: anything outside Core (QQQ/SPY) + Focus (mag7/semis) must
  // clear A+ (>=90). The edge is Core+Focus; the rest must be exceptional.
  if (idea.tier === 'extended' && decision.confidence < r.extendedMinConfidence) {
    blocks.push(`extended_below_A+ (${decision.confidence} < ${r.extendedMinConfidence})`);
  }

  // Correlation heat cap — QQQ/NVDA/SMH long is ONE trade, not many. Cap simultaneous
  // SAME-DIRECTION open exposure per correlation cluster.
  const heatKey = `${clusterOf(idea.ticker)}:${idea.direction}`;
  const heat = day.openClusters[heatKey] ?? 0;
  if (heat >= r.maxCorrelatedHeat) {
    blocks.push(`correlation_heat (${heat}/${r.maxCorrelatedHeat} ${heatKey})`);
  }

  // Chase guard — if price already left the entry zone by more than the buffer, the
  // trade is gone (no chasing). Only checked when a live price is supplied.
  if (currentPrice != null && idea.entry != null && idea.entry !== 0) {
    const driftPct = (Math.abs(currentPrice - idea.entry) / idea.entry) * 100;
    if (driftPct > r.chaseGuardPct) blocks.push(`chased (${driftPct.toFixed(2)}% past entry > ${r.chaseGuardPct}%)`);
  }

  // Name-level cooldown — after a loss on a ticker, that name is locked (kills the
  // revenge trade), independent of the global loss-streak cooldown.
  const nameLock = day.cooldownByTicker[idea.ticker];
  if (nameLock != null && now < nameLock) {
    blocks.push(`name_cooldown ${idea.ticker} (${Math.ceil((nameLock - now) / 60000)}m left)`);
  }

  // Lunch-lull suppression (11:30–13:30 ET) — low-volume chop where accounts bleed.
  if (r.suppressLunch && inLunchWindow(new Date(now), r.lunchStartMinEt, r.lunchEndMinEt)) {
    blocks.push('lunch_lull_suppressed (11:30-13:30 ET)');
  }

  // 0DTE policy — don't open new same-day expiries near the close; be flat by ~15:55 ET.
  if (idea.contract.dte === 0 && etMinutes(new Date(now)) >= r.zeroDteFlatByMinEt) {
    blocks.push('0DTE_after_flat_by (too late to open same-day)');
  }

  // Event risk stays a HARD block — capital protection (Josh didn't opt into
  // event-day scalping). Regime + thin-confluence are SOFTENED to warnings below.
  if (flags.has('event_risk') || flags.has('earnings_event_risk') || flags.has('macro_event')) {
    blocks.push('event_risk_blackout');
  }
  // Trade-count cap is OFF by default (maxTradesPerDay=0 → unlimited). The daily-loss
  // + loss-streak cooldown brakes below still cap real capital at risk.
  if (r.maxTradesPerDay > 0 && day.tradesToday >= r.maxTradesPerDay) {
    blocks.push(`overtrading (${day.tradesToday}/${r.maxTradesPerDay})`);
  }

  const maxDailyLoss = (r.maxDailyLossPct / 100) * r.accountSizeUsd;
  if (day.realizedPnlUsd <= -maxDailyLoss) blocks.push(`max_daily_loss hit (${day.realizedPnlUsd.toFixed(0)} <= -${maxDailyLoss.toFixed(0)})`);

  if (day.cooldownUntil != null && now < day.cooldownUntil) {
    const mins = Math.ceil((day.cooldownUntil - now) / 60000);
    blocks.push(`cooldown_active (${mins}m left)`);
  }

  // Stand-down (set at day-roll: weekly breaker etc.) — nothing fires today.
  if (day.standDownReason) blocks.push(`stand_down (${day.standDownReason})`);

  // Aggregate exposure — the daily-loss breaker only sees REALIZED P&L; without
  // these, a correlated flush across open positions can blow through it unseen.
  // Measured AT THE STOP (with a gap haircut), not full premium — the signal is
  // the signal; the account guardrail charges what a stop-out actually costs.
  const sized = sizePosition(idea, day.sizeMultiplier ?? 1, decision.grade);
  if ((day.openPositionsCount ?? 0) >= r.maxOpenPositions) {
    blocks.push(`max_open_positions (${day.openPositionsCount}/${r.maxOpenPositions} on)`);
  }
  const maxOpenRisk = (r.maxOpenRiskPct / 100) * r.accountSizeUsd;
  if (sized.riskAtStopUsd > 0 && (day.openRiskUsd ?? 0) + sized.riskAtStopUsd > maxOpenRisk) {
    blocks.push(`open_risk_cap ($${Math.round(day.openRiskUsd)} at-stop on + ~$${sized.riskAtStopUsd} > $${Math.round(maxOpenRisk)} total)`);
  }

  // Profit lock — a green day is not allowed to round-trip red. Once the day's
  // peak clears the trigger, giving back half of it stands the bot down.
  const lockTrigger = (r.profitLockTriggerPct / 100) * r.accountSizeUsd;
  const peak = day.peakPnlUsd ?? 0;
  if (peak >= lockTrigger && day.realizedPnlUsd <= peak * (1 - r.profitLockGivebackPct / 100)) {
    blocks.push(`profit_lock (peaked +$${Math.round(peak)}, gave back to +$${Math.round(day.realizedPnlUsd)} — bank the day)`);
  }

  // --- Warnings (not blocking) ---
  if (rr == null) warnings.push('reward/risk undefined (no target)');
  if (flags.has('thin_oi')) warnings.push('thin open interest');
  if (idea.mtf?.conflict) warnings.push('timeframe conflict — intervals disagree');
  if (flags.has('fighting_htf')) warnings.push('fighting the higher-timeframe trend stack');
  if (flags.has('dead_tape')) warnings.push('dead tape — weak RVOL, breakout suspect');
  if (decision.grade === 'B') warnings.push('B grade — watch, not a fire');
  if (decision.breakdown.factors.regime.score < r.minRegimeScore) {
    warnings.push(`weak regime (${decision.breakdown.factors.regime.score}/${r.minRegimeScore}) — size down`);
  }
  if (decision.breakdown.confluenceCount < 2) warnings.push('thin confluence — one lens carrying it');

  // --- Position sizing (computed above for the aggregate cap) ---
  // Size is a SUGGESTION, never a veto: the contract is the contract — a rich
  // premium means fewer (minimum one) contracts, not a deleted signal.
  const { positionContracts, maxLossUsd } = sized;

  return {
    approved: blocks.length === 0,
    blocks,
    warnings,
    positionContracts,
    maxLossUsd,
    stop: idea.stop,
    targets: idea.targets,
    rewardRisk: rr,
  };
}

/** The gap haircut on stop-based risk — 0DTE can gap through a stop; assume a
 *  stop-out costs 25% more than the plan says. */
const GAP_HAIRCUT = 1.25;

/** What a stop-out actually costs (haircutted), for the aggregate exposure cap.
 *  The no-stop fallback is 35% of premium — the SAME number the exit monitor
 *  uses when it books a bare-stop close (fill × 0.65 stop), so the risk ledger
 *  reserves and releases identical amounts. A mismatch here slowly accumulates
 *  phantom open risk until the cap blocks real trades. Floored at 15% of cash
 *  deployed so a position never counts as free. */
export function riskAtStopUsd(fillPremium: number, stopPremium: number, contracts: number, costPaidUsd: number): number {
  const perShare = stopPremium > 0 && stopPremium < fillPremium
    ? fillPremium - stopPremium
    : fillPremium * 0.35;
  return Math.max(
    Math.round(perShare * 100 * contracts * GAP_HAIRCUT),
    Math.round(costPaidUsd * 0.15),
  );
}

/** Suggested size — NEVER a veto (minimum one contract when levels exist). Risk
 *  per contract = the chart-based premium stop (mirrors the Exit Brain's loss cap
 *  by horizon) plus the gap haircut; budget = account × maxRiskPerTrade% × the
 *  day's multiplier. A+ conviction leans in 1.5x — "this one's supposed to work." */
function sizePosition(
  idea: TradeIdea,
  multiplier = 1,
  grade?: GovernorDecision['grade'],
): { positionContracts: number; maxLossUsd: number; riskAtStopUsd: number } {
  const r = config.risk;
  const budget = (r.maxRiskPerTradePct / 100) * r.accountSizeUsd * Math.max(0.1, Math.min(1, multiplier));
  if (idea.entry == null || idea.stop == null) return { positionContracts: 0, maxLossUsd: 0, riskAtStopUsd: 0 };

  const premium = idea.premium != null && idea.premium > 0 ? idea.premium : null;
  const horizon = idea.timeframe ?? 'intraday';
  // Same premium loss caps the Exit Brain plans with (scalp 35 / intraday 40 / swing 50).
  const stopPct = horizon === 'scalp' ? 35 : horizon === 'intraday' ? 40 : 50;
  const perContractRisk = premium != null
    ? premium * (stopPct / 100) * GAP_HAIRCUT * 100
    : Math.abs(idea.entry - idea.stop) * 100;
  if (perContractRisk <= 0) return { positionContracts: 0, maxLossUsd: 0, riskAtStopUsd: 0 };

  let contracts = Math.max(1, Math.floor(budget / perContractRisk));
  if (grade === 'A+') contracts = Math.ceil(contracts * 1.5); // lean in on conviction
  return {
    positionContracts: contracts,
    maxLossUsd: Math.round(contracts * (premium != null ? premium * 100 : perContractRisk)), // worst case: premium to zero
    riskAtStopUsd: Math.round(contracts * perContractRisk),
  };
}

/** Roll the day-state forward after a closed trade (drives cooldown + daily loss +
 *  the profit-lock high-water mark). NOTE: tradesToday increments at OPEN (the
 *  pipeline), not here — counting both sides double-billed every round trip. */
export function recordTradeResult(day: DayState, pnlUsd: number, now = Date.now()): DayState {
  const r = config.risk;
  const realized = day.realizedPnlUsd + pnlUsd;
  const next: DayState = {
    ...day,
    realizedPnlUsd: realized,
    peakPnlUsd: Math.max(day.peakPnlUsd ?? 0, realized),
    consecutiveLosses: pnlUsd < 0 ? day.consecutiveLosses + 1 : 0,
    cooldownUntil: day.cooldownUntil,
    cooldownCount: day.cooldownCount ?? 0,
  };
  if (next.consecutiveLosses >= r.maxConsecutiveLosses) {
    next.cooldownCount += 1;
    // Escalate: the first streak is a pause; the second means the day is over —
    // losses 3 and 4 statistically come in the worst conditions of the day.
    next.cooldownUntil = next.cooldownCount >= 2
      ? now + Math.max(r.cooldownMinutes, 960 - etMinutes(new Date(now))) * 60_000 // through the close
      : now + r.cooldownMinutes * 60_000;
    next.consecutiveLosses = 0; // reset after triggering cooldown
  }
  return next;
}

export function freshDay(date = new Date().toISOString().slice(0, 10)): DayState {
  return {
    date, tradesToday: 0, realizedPnlUsd: 0, peakPnlUsd: 0, consecutiveLosses: 0,
    cooldownUntil: null, cooldownCount: 0, cooldownByTicker: {}, openClusters: {},
    openPositionsCount: 0, openRiskUsd: 0, sizeMultiplier: 1, standDownReason: null,
    closed: [],
  };
}
