// Component 5 — Discord Alert Copilot (Entry/Exit Architect). Renders a clean signal
// (or a "BOT PASSED" card) with contract style, expected trade length, live
// market/news context, and now the entry ticket: universe tier, exact entry time,
// modeled cost paid, and the time-to-be-flat. The Watching-feed formatting lives in
// dispatch.ts; this builds the canonical alert object + plain text.

import type {
  TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, AlertStatus, MarketContext, ExitPlan, Tier,
} from '../lib/types.js';
import { config } from '../lib/config.js';
import { deriveExitPlan } from '../engine/exitPlan.js';
import { applyRealisticFill } from '../backtest/index.js';
import { etTimeString } from '../lib/clock.js';
import { tierOf } from '../scan/universe.js';

export function buildAlert(
  idea: TradeIdea,
  decision: GovernorDecision,
  fw: FirewallResult,
  ctx: MarketContext,
): PremiumFloorAlert {
  const contractStr = `${idea.ticker} ${fmt(idea.contract.strike)}${idea.contract.optionType === 'call' ? 'C' : 'P'} ${idea.contract.expiry || ''}`.trim();
  const contractStyle = deriveContractStyle(idea);
  const tradeLength = deriveTradeLength(idea);
  const newsContext = deriveNewsContext(ctx);
  const exitPlan = deriveExitPlan(idea, fw);
  const choppy = isChoppy(ctx, decision);

  // Entry ticket — tier, exact entry time (ET), modeled cost paid, time-to-flat.
  const tier = idea.tier ?? tierOf(idea.ticker);
  const entryTimeEt = etTimeString();
  const timeToFlat = deriveTimeToFlat(idea);
  const fill = fw.approved && fw.positionContracts > 0 ? applyRealisticFill(idea.premium, fw.positionContracts) : null;
  const costPerContractUsd = fill?.costPerContractUsd ?? null;
  const costPaidUsd = fill?.costPaidUsd ?? null;
  const extra: Derived = { contractStyle, tradeLength, newsContext, exitPlan, tier, entryTimeEt, timeToFlat, costPerContractUsd, costPaidUsd };

  if (!fw.approved || decision.grade === 'D') {
    const text = [
      '⚠️ **BOT PASSED ON TRADE**',
      '',
      `Ticker: ${idea.ticker}`,
      `Idea: ${idea.direction} ${idea.contract.optionType} · ${idea.setup}`,
      `Reason for rejection: ${(fw.blocks[0] ?? decision.reasons[0] ?? 'below confidence threshold')}`,
      fw.blocks.length > 1 ? `Also: ${fw.blocks.slice(1).join(', ')}` : '',
      `Confidence: ${decision.confidence}% (raw ${decision.total}/100) · ${gradeLabel(decision.grade)}`,
      `What needs to change: ${whatWouldFix(fw, decision)}`,
    ].filter(Boolean).join('\n');
    return base(idea, decision, fw, 'rejection', 'rejected', text, extra);
  }

  const status: AlertStatus = decision.grade === 'B'
    ? 'watch'
    : config.liveTrading ? 'approval' : 'paper';

  const costLine = costPaidUsd != null
    ? `💵 Cost (modeled): $${costPerContractUsd}/contract · $${costPaidUsd} total — estimate, no live chain`
    : '';

  const text = [
    `🚨 **${config.botName.toUpperCase()} SIGNAL**`,
    '',
    `Ticker: ${idea.ticker}  ·  ${tierLabel(tier)}`,
    `Bias: ${idea.direction === 'long' ? 'CALLS' : 'PUTS'}`,
    `Setup: ${idea.setup}`,
    `Contract: ${contractStr}`,
    `Contract style: ${contractStyle}`,
    `Entry Zone: ${fmt(idea.entry)}`,
    `⏰ Getting in @ ${entryTimeEt} ET  ·  flat by: ${timeToFlat}`,
    `Stop: ${fmt(fw.stop)}`,
    `Targets: ${fw.targets.map(fmt).join(' / ') || '—'}`,
    `Trade length: ${tradeLength}`,
    ...exitLines(exitPlan),
    `Timeframes: ${mtfLine(idea)}`,
    `Confidence: ${decision.confidence}%  ·  ${gradeLabel(decision.grade)}`,
    `Size: ${fw.positionContracts} contract(s) · max risk $${fw.maxLossUsd}${fw.rewardRisk != null ? ` · R:R ${fw.rewardRisk.toFixed(2)}` : ''}`,
    costLine,
    '',
    'Why:',
    ...decision.reasons.slice(0, 3).map((r) => `• ${r}`),
    '',
    `Market/News: ${newsContext}`,
    `Risk: ${riskLine(fw)}${choppy ? ' · ⚠️ choppy/elevated-vol — size down' : ''}`,
    `Status: ${statusLabel(status)}`,
  ].filter(Boolean).join('\n');

  return base(idea, decision, fw, 'alert', status, text, extra);
}

interface Derived {
  contractStyle: string; tradeLength: string; newsContext: string; exitPlan: ExitPlan;
  tier: Tier; entryTimeEt: string; timeToFlat: string;
  costPerContractUsd: number | null; costPaidUsd: number | null;
}

/** Render the Exit Brain as the human-facing block in the alert text. */
function exitLines(ep: ExitPlan): string[] {
  if (!ep.takeProfits.length) return [`⏱ Exit window: ${ep.holdWindow}`, `🛑 ${ep.invalidation}`];
  const lines = [`⏱ Exit window: ${ep.holdWindow}`];
  for (const tp of ep.takeProfits) {
    lines.push(`🎯 ${tp.label}: ${signed(tp.premiumPct)} premium (~$${tp.premium}${tp.underlying != null ? ` @ ${tp.underlying}` : ''}) — ${tp.action}`);
  }
  lines.push(`🛑 ${ep.stop.label}: ${signed(ep.stop.premiumPct)} (~$${ep.stop.premium}) — ${ep.invalidation}`);
  lines.push(`🏃 Runner: ${ep.runnerTrigger}`);
  return lines;
}
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;

function base(
  idea: TradeIdea, decision: GovernorDecision, fw: FirewallResult,
  kind: 'alert' | 'rejection', status: AlertStatus, text: string, d: Derived,
): PremiumFloorAlert {
  return {
    kind, ticker: idea.ticker, direction: idea.direction, setup: idea.setup,
    contract: idea.contract, entry: idea.entry, stop: fw.stop, targets: fw.targets,
    confidence: decision.confidence, grade: decision.grade,
    why: decision.reasons, risk: riskLine(fw), status,
    contractStyle: d.contractStyle, tradeLength: d.tradeLength, newsContext: d.newsContext,
    tier: d.tier, entryTimeEt: d.entryTimeEt, timeToFlat: d.timeToFlat,
    costPerContractUsd: d.costPerContractUsd, costPaidUsd: d.costPaidUsd,
    exitPlan: d.exitPlan, text,
  };
}

// ---- Derivations (Stage 1 rules; Stage 2 deepens with real MTF/DTE logic) ----

// Contract style now reflects WHICH timeframes confirmed (Stage 2 MTF):
// 1m-only → 0DTE scalp · +5m → weekly day-trade · +15m → farther-out swing.
export function deriveContractStyle(idea: TradeIdea): string {
  const tfs = idea.mtf?.timeframes.join('+') || 'single-TF';
  const dte = idea.contract.dte;
  switch (idea.timeframe) {
    case 'scalp': return `0DTE same-day — pure gamma scalp (${tfs})`;
    case 'swing': return `${dte ?? 7}DTE — multi-day, ${tfs} confirm, room to breathe`;
    case 'intraday':
    default: return `${dte ?? 3}DTE — day-to-few-days, ${tfs} aligned, cuts theta`;
  }
}

export function deriveTradeLength(idea: TradeIdea): string {
  switch (idea.timeframe) {
    case 'scalp': return 'Quick scalp · 5–15 min';
    case 'swing': return 'Swing · hours to ~2 days';
    case 'intraday':
    default: return 'Day trade · 30–90 min';
  }
}

const tierLabel = (t: Tier): string =>
  t === 'core' ? 'CORE (QQQ/SPY)' : t === 'focus' ? 'FOCUS (mag7/semis)' : 'EXTENDED (A+ only)';

/** Concise "be flat by" for the entry ticket — 0DTE has a hard EOD clock. */
function deriveTimeToFlat(idea: TradeIdea): string {
  if (idea.contract.dte === 0) return 'Flat by 15:55 ET (0DTE — no overnight)';
  switch (idea.timeframe) {
    case 'scalp': return 'Flat within ~15 min';
    case 'swing': return 'Manage 1–2 days';
    default: return 'Flat by the close';
  }
}

const mtfLine = (idea: TradeIdea): string =>
  idea.mtf
    ? `${idea.mtf.timeframes.join(', ')} ✓ (${idea.mtf.agreement}/3)${idea.mtf.conflict ? ' · ⚠️ conflict' : ''}`
    : '—';

export function deriveNewsContext(ctx: MarketContext): string {
  const parts = [`SPY ${ctx.spyTrend}/QQQ ${ctx.qqqTrend} · VIX≈${ctx.vix} · F&G ${ctx.fearGreed} (${fgLabel(ctx.fearGreed)})`];
  if (ctx.eventRiskToday) parts.push('⚠️ event-risk day');
  if (ctx.earningsSoon) parts.push('⚠️ earnings imminent');
  if (ctx.headlines[0]) parts.push(`📰 ${ctx.headlines[0]}`);
  return parts.join(' · ');
}

function isChoppy(ctx: MarketContext, decision: GovernorDecision): boolean {
  return ctx.spyTrend === 'flat' || ctx.vix > 22 || decision.breakdown.factors.regime.score < 55;
}

const fgLabel = (n: number) => (n < 25 ? 'extreme fear' : n < 45 ? 'fear' : n < 55 ? 'neutral' : n < 75 ? 'greed' : 'extreme greed');
const fmt = (n: number | null | undefined) => (n == null ? '—' : String(n));
const gradeLabel = (g: string) =>
  g === 'A+' ? '🔥 A+ SIGNAL' : g === 'A' ? '🚨 A SIGNAL' : g === 'B' ? '👀 B WATCHING' : g === 'C' ? '👁 C watch' : 'PASS';

function statusLabel(s: AlertStatus): string {
  switch (s) {
    case 'watch': return 'WATCH ONLY';
    case 'paper': return 'PAPER (live trading disabled)';
    case 'approval': return 'AWAITING APPROVAL';
    case 'live-disabled': return 'LIVE DISABLED';
    case 'rejected': return 'REJECTED';
  }
}

function riskLine(fw: FirewallResult): string {
  const parts = [`max $${fw.maxLossUsd}`];
  if (fw.rewardRisk != null) parts.push(`R:R ${fw.rewardRisk.toFixed(2)}`);
  if (fw.warnings.length) parts.push(...fw.warnings);
  return parts.join(' · ');
}

function whatWouldFix(fw: FirewallResult, decision: GovernorDecision): string {
  if (fw.blocks.some((b) => b.startsWith('no_clear_stop'))) return 'define a clear stop';
  if (fw.blocks.some((b) => b.includes('spread'))) return 'find a tighter contract';
  if (fw.blocks.some((b) => b.includes('reward_risk'))) return 'better entry for ≥1.5 R:R';
  if (fw.blocks.some((b) => b.includes('extended_below'))) return 'Extended-universe name — needs A+ (≥90)';
  if (fw.blocks.some((b) => b.includes('correlation_heat'))) return 'already loaded in this cluster — wait for one to close';
  if (fw.blocks.some((b) => b.includes('chased'))) return 'price ran — wait for a pullback into the zone';
  if (fw.blocks.some((b) => b.includes('lunch'))) return 'lunch chop — wait for the afternoon trend';
  if (fw.blocks.some((b) => b.includes('regime'))) return 'wait for a friendlier regime';
  if (fw.blocks.some((b) => b.includes('event'))) return 'wait until after the event';
  if (decision.grade === 'B') return 'one more confirmation to promote from watch';
  return 'more confluence across factors';
}
