// Component 4 — Risk Discipline Firewall. Hard blocks + position sizing + the
// daily-loss / cooldown / overtrading governors. Nothing reaches a broker
// without passing here. A governor REJECT is honored as a hard block.

import type {
  TradeIdea, GovernorDecision, FirewallResult, DayState, FactorScore,
} from '../lib/types.js';
import { config, clusterOf } from '../lib/config.js';
import { inLunchWindow, etMinutes } from '../lib/clock.js';
import { rewardRisk } from '../scoring/index.js';

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

  // --- Warnings (not blocking) ---
  if (rr == null) warnings.push('reward/risk undefined (no target)');
  if (flags.has('thin_oi')) warnings.push('thin open interest');
  if (idea.mtf?.conflict) warnings.push('timeframe conflict — intervals disagree');
  if (decision.grade === 'B') warnings.push('B grade — watch, not a fire');
  if (decision.breakdown.factors.regime.score < r.minRegimeScore) {
    warnings.push(`weak regime (${decision.breakdown.factors.regime.score}/${r.minRegimeScore}) — size down`);
  }
  if (decision.breakdown.confluenceCount < 2) warnings.push('thin confluence — one lens carrying it');

  // --- Position sizing (only meaningful if approved) ---
  const { positionContracts, maxLossUsd } = sizePosition(idea);
  // Can't take even one contract within the per-trade risk budget → pass, don't
  // emit a misleading zero-size alert.
  if (idea.entry != null && idea.stop != null && positionContracts === 0) {
    blocks.push('position_exceeds_risk_budget (size down or raise risk %)');
  }

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

/** Risk-based sizing: budget = account × maxRiskPerTrade%; perContractRisk = (entry−stop)×100. */
function sizePosition(idea: TradeIdea): { positionContracts: number; maxLossUsd: number } {
  const r = config.risk;
  const budget = (r.maxRiskPerTradePct / 100) * r.accountSizeUsd;
  if (idea.entry == null || idea.stop == null) return { positionContracts: 0, maxLossUsd: 0 };

  // Prefer option-premium risk when known (premium is the true max loss for a long option);
  // otherwise approximate with the underlying stop distance × 100 multiplier.
  const perContractRisk = idea.premium != null
    ? idea.premium * 100
    : Math.abs(idea.entry - idea.stop) * 100;
  if (perContractRisk <= 0) return { positionContracts: 0, maxLossUsd: 0 };

  const contracts = Math.max(0, Math.floor(budget / perContractRisk));
  return { positionContracts: contracts, maxLossUsd: Math.round(contracts * perContractRisk) };
}

/** Roll the day-state forward after a closed trade (drives cooldown + daily loss). */
export function recordTradeResult(day: DayState, pnlUsd: number, now = Date.now()): DayState {
  const r = config.risk;
  const next: DayState = {
    ...day,
    tradesToday: day.tradesToday + 1,
    realizedPnlUsd: day.realizedPnlUsd + pnlUsd,
    consecutiveLosses: pnlUsd < 0 ? day.consecutiveLosses + 1 : 0,
    cooldownUntil: day.cooldownUntil,
  };
  if (next.consecutiveLosses >= r.maxConsecutiveLosses) {
    next.cooldownUntil = now + r.cooldownMinutes * 60_000;
    next.consecutiveLosses = 0; // reset after triggering cooldown
  }
  return next;
}

export function freshDay(date = new Date().toISOString().slice(0, 10)): DayState {
  return {
    date, tradesToday: 0, realizedPnlUsd: 0, consecutiveLosses: 0, cooldownUntil: null,
    cooldownByTicker: {}, openClusters: {}, closed: [],
  };
}
