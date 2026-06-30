// Component 4 — Risk Discipline Firewall. Hard blocks + position sizing + the
// daily-loss / cooldown / overtrading governors. Nothing reaches a broker
// without passing here. A governor REJECT is honored as a hard block.

import type {
  TradeIdea, GovernorDecision, FirewallResult, DayState, FactorScore,
} from '../lib/types.js';
import { config } from '../lib/config.js';
import { rewardRisk } from '../scoring/index.js';

export function runFirewall(
  idea: TradeIdea,
  decision: GovernorDecision,
  day: DayState,
  now = Date.now(),
): FirewallResult {
  const r = config.risk;
  const blocks: string[] = [];
  const warnings: string[] = [];
  const flags = new Set<string>(
    (Object.values(decision.breakdown.factors) as FactorScore[]).flatMap((f) => f.flags),
  );

  // --- Hard blocks ---
  if (decision.grade === 'REJECT') blocks.push('governor_reject (<65) — no trade');
  if (idea.stop == null) blocks.push('no_clear_stop');
  if (flags.has('wide_spread')) blocks.push('spread_too_wide');

  const rr = rewardRisk(idea);
  if (rr != null && rr < r.minRewardRisk) blocks.push(`reward_risk ${rr.toFixed(2)} < ${r.minRewardRisk}`);

  // Event risk stays a HARD block — capital protection (Josh didn't opt into
  // event-day scalping). Regime + thin-confluence are SOFTENED to warnings below so
  // the "signal as many as it wants ≥80%" mandate isn't muzzled by discipline gates.
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
  if (decision.grade === 'WATCH') warnings.push('WATCH grade — observe, not a fire');
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
  return { date, tradesToday: 0, realizedPnlUsd: 0, consecutiveLosses: 0, cooldownUntil: null };
}
