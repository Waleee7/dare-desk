// Component 2 — the signal scoring engine. Six independent lenses, each 0-100
// on its own axis, each LLM-scored with a cached rubric and a deterministic
// heuristic fallback. The governor (component 3) weights and combines them.

import { z } from 'zod';
import type { TradeIdea, MarketContext, FactorScore, FactorName } from '../lib/types.js';
import { structuredCall } from '../lib/llm.js';

const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string(),
  flags: z.array(z.string()),
});

async function llmOrHeuristic(
  factor: FactorName,
  system: string,
  user: string,
  heuristic: () => Omit<FactorScore, 'factor' | 'source'>,
): Promise<FactorScore> {
  const out = await structuredCall(ScoreSchema, { system, user });
  if (out) {
    return {
      factor,
      score: clamp(out.score),
      rationale: out.rationale,
      flags: out.flags,
      source: 'llm',
    };
  }
  const h = heuristic();
  return { factor, ...h, score: clamp(h.score), source: 'heuristic' };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function ideaText(idea: TradeIdea): string {
  return [
    `Ticker: ${idea.ticker}`,
    `Direction: ${idea.direction} (${idea.contract.optionType})`,
    `Setup: ${idea.setup}`,
    `Strike/Expiry: ${idea.contract.strike} ${idea.contract.expiry || '(unknown)'}`,
    `Entry: ${idea.entry ?? '?'}  Stop: ${idea.stop ?? '?'}  Targets: ${idea.targets.join(', ') || '?'}`,
    `Premium: ${idea.premium ?? '?'}  Catalyst: ${idea.catalyst ?? 'none'}`,
    `MTF: ${idea.mtf ? `${idea.mtf.timeframes.join('+')} confirm${idea.mtf.conflict ? ' — CONFLICT on another timeframe' : ''}` : 'n/a'}`,
  ].join('\n');
}

function ctxText(ctx: MarketContext): string {
  return [
    `SPY ${ctx.spyTrend}, QQQ ${ctx.qqqTrend}, VIX ${ctx.vix} (${ctx.vixTrend})`,
    `Breadth ${ctx.breadth}, Fear&Greed ${ctx.fearGreed}, Put/Call ${ctx.putCallRatio ?? '?'}`,
    `Event risk today: ${ctx.eventRiskToday}. Earnings soon: ${ctx.earningsSoon}.`,
    `Headlines: ${ctx.headlines.slice(0, 5).join(' | ') || 'none'}`,
  ].join('\n');
}

const KNOWN_SETUPS = /vwap|opening range|liquidity sweep|trendline|higher-low|lower-high|gap|relative strength|relative weakness|failed break|momentum|unusual|flow|breakout|reclaim|prior-day|pullback|continuation|sweep/i;

// ---- 1. Technical ----------------------------------------------------------
export function scoreTechnical(idea: TradeIdea, ctx: MarketContext): Promise<FactorScore> {
  const system = `Score the TECHNICAL SETUP quality of an options trade idea, 0-100.
Reward clear, recognizable setups with a defined entry, stop, and target. Penalize
vague or "chasing" entries and missing levels. Output {score, rationale, flags}.`;
  return llmOrHeuristic('technical', system, `${ideaText(idea)}\n\n${ctxText(ctx)}`, () => {
    let s = 45;
    const flags: string[] = [];
    if (KNOWN_SETUPS.test(idea.setup)) s += 18; else flags.push('vague_setup');
    if (idea.entry != null) s += 6; else flags.push('no_entry');
    if (idea.stop != null) s += 8; else flags.push('no_stop');
    if (idea.targets.length) s += 8; else flags.push('no_target');
    if (idea.rawConfidence != null) s += Math.min(10, idea.rawConfidence);
    // Multi-timeframe: confirmation lifts conviction, conflict tanks it (→ Watching).
    if (idea.mtf) {
      s += (idea.mtf.agreement - 1) * 6; // +6 per extra confirming timeframe
      if (idea.mtf.conflict) { s -= 15; flags.push('mtf_conflict'); }
      else if (idea.mtf.agreement >= 2) flags.push(`mtf_${idea.mtf.agreement}tf`);
    }
    return { score: s, rationale: `Heuristic: "${idea.setup}", ${idea.mtf ? `${idea.mtf.timeframes.join('+')} TF${idea.mtf.conflict ? ' (conflict)' : ''}` : 'single TF'}, levels ${idea.stop != null ? 'defined' : 'incomplete'}.`, flags };
  });
}

// ---- 2. Josh Trader Lens ---------------------------------------------------
export function scoreJoshLens(idea: TradeIdea, ctx: MarketContext): Promise<FactorScore> {
  const system = `Score how much this matches an experienced discretionary options trader's eye, 0-100.
Favor: VWAP reclaim/rejection, opening-range break, liquidity-sweep reversal, trendline break+retest,
gap-and-go, failed breakdown/breakout, relative strength/weakness, news+technical confirmation, SPY/QQQ alignment.
This is the "would Josh take it" lens — reward real edge, not vibes. Output {score, rationale, flags}.`;
  return llmOrHeuristic('joshLens', system, `${ideaText(idea)}\n\n${ctxText(ctx)}`, () => {
    let s = 50;
    const flags: string[] = [];
    if (KNOWN_SETUPS.test(idea.setup)) s += 15; else flags.push('not_a_josh_setup');
    const indicesAgree = ctx.spyTrend === ctx.qqqTrend && ctx.spyTrend !== 'flat';
    const aligned = (idea.direction === 'long' && ctx.spyTrend === 'up')
      || (idea.direction === 'short' && ctx.spyTrend === 'down');
    if (aligned) s += 12; else flags.push('index_misaligned');
    if (aligned && indicesAgree) s += 8; // both indices in gear — the tape Josh trades
    if (idea.catalyst) s += 6;
    const tape = aligned ? (indicesAgree ? 'index-aligned, SPY+QQQ in gear' : 'index-aligned') : 'fighting the index';
    return { score: s, rationale: `Heuristic: ${tape}; setup "${idea.setup}".`, flags };
  });
}

// ---- 3. Market Regime Sentinel --------------------------------------------
export function scoreRegime(idea: TradeIdea, ctx: MarketContext): Promise<FactorScore> {
  const system = `Score whether MARKET CONDITIONS support this trade, 0-100.
Calls need index strength or a clean reversal; puts need weakness/failed reclaim. SPY and QQQ
moving the SAME way is the strongest tailwind — reward it; SPY/QQQ diverging signals chop — penalize.
Penalize spiking VIX, event-risk days, and extreme sentiment against the trade. Output {score, rationale, flags}.`;
  return llmOrHeuristic('regime', system, `${ideaText(idea)}\n\n${ctxText(ctx)}`, () => {
    let s = 60;
    const flags: string[] = [];
    // SPY↔QQQ cross-confirmation — the index-specialist read.
    const indicesAgree = ctx.spyTrend === ctx.qqqTrend && ctx.spyTrend !== 'flat';
    const indicesDiverge = ctx.spyTrend !== 'flat' && ctx.qqqTrend !== 'flat' && ctx.spyTrend !== ctx.qqqTrend;
    const trend = idea.ticker === 'QQQ' ? ctx.qqqTrend : ctx.spyTrend;
    const aligned = (idea.direction === 'long' && trend === 'up') || (idea.direction === 'short' && trend === 'down');
    if (aligned && indicesAgree) { s += 24; flags.push('indices_confirm'); }
    else if (aligned) s += 16;
    else if (trend === 'flat') { s -= 10; flags.push('choppy'); }
    else { s -= 18; flags.push('regime_against'); }
    if (indicesDiverge) { s -= 8; flags.push('index_divergence'); }
    if (ctx.vixTrend === 'up' && ctx.vix > 22) { s -= 12; flags.push('vix_spiking'); }
    if (ctx.eventRiskToday) { s -= 15; flags.push('event_risk'); }
    if (idea.direction === 'long' && ctx.fearGreed < 20) { s -= 8; flags.push('extreme_fear'); }
    const idxNote = indicesAgree ? ', SPY+QQQ confirm' : indicesDiverge ? ', but SPY/QQQ diverging' : '';
    return { score: s, rationale: `Heuristic: ${aligned ? 'aligned with' : 'against'} ${trend} regime${idxNote}; VIX ${ctx.vix}.`, flags };
  });
}

// ---- 4. News / Catalyst Radar ---------------------------------------------
export function scoreNews(idea: TradeIdea, ctx: MarketContext): Promise<FactorScore> {
  const system = `Score the NEWS/CATALYST picture for this trade, 0-100.
Confirmed directional catalyst = boost. Unknown event risk (earnings into the trade, macro prints)
without an event strategy = penalty. Inflated IV from a known event = warn. Output {score, rationale, flags}.`;
  return llmOrHeuristic('news', system, `${ideaText(idea)}\n\n${ctxText(ctx)}`, () => {
    // A clean tape with no event risk is mildly supportive, not neutral-negative.
    let s = 65;
    const flags: string[] = [];
    if (idea.catalyst) s += 12;
    if (ctx.earningsSoon) { s -= 28; flags.push('earnings_event_risk'); }
    if (ctx.eventRiskToday) { s -= 14; flags.push('macro_event'); }
    return { score: s, rationale: `Heuristic: ${ctx.earningsSoon ? 'earnings event risk' : 'no imminent earnings'}; catalyst ${idea.catalyst ? 'present' : 'none'}.`, flags };
  });
}

// ---- 5. Options Chain Sniper ----------------------------------------------
export function scoreOptionsChain(idea: TradeIdea, _ctx: MarketContext): Promise<FactorScore> {
  const system = `Score the OPTIONS CONTRACT quality for execution, 0-100.
Reward tight bid/ask, real volume + open interest, responsive delta, and an expiration that fits the setup.
A good stock setup with a trash contract is still a bad trade. Output {score, rationale, flags}.`;
  return llmOrHeuristic('optionsChain', system, ideaText(idea), () => {
    const c = idea.contract;
    const flags: string[] = [];
    if (c.bid == null || c.ask == null) {
      // No paid options feed yet → can't verify the contract. Stay NEUTRAL (don't
      // punish the trade for a disclosed data gap); flag it so it's transparent.
      flags.push('chain_unverified');
      return { score: 68, rationale: 'Heuristic: contract quality unverified (no live chain feed) — neutral, not counted against the trade.', flags };
    }
    const mid = (c.bid + c.ask) / 2 || 1;
    const spreadPct = ((c.ask - c.bid) / mid) * 100;
    let s = 80;
    if (spreadPct > 10) { s -= 30; flags.push('wide_spread'); }
    else if (spreadPct > 6) { s -= 15; flags.push('moderate_spread'); }
    if ((c.openInterest ?? 0) < 250) { s -= 15; flags.push('thin_oi'); }
    if ((c.volume ?? 0) < 100) { s -= 10; flags.push('low_volume'); }
    return { score: s, rationale: `Heuristic: spread ${spreadPct.toFixed(1)}%, OI ${c.openInterest ?? '?'}, vol ${c.volume ?? '?'}.`, flags };
  });
}

// ---- 6. Risk / Reward ------------------------------------------------------
export function scoreRiskReward(idea: TradeIdea, _ctx: MarketContext): Promise<FactorScore> {
  const system = `Score the RISK/REWARD of this trade, 0-100, based on entry, stop, and first target.
No stop or no target = very low score. Reward ratios >= 1.5; strongly reward >= 2. Output {score, rationale, flags}.`;
  return llmOrHeuristic('riskReward', system, ideaText(idea), () => {
    const rr = rewardRisk(idea);
    const flags: string[] = [];
    if (rr == null) { flags.push('rr_undefined'); return { score: 30, rationale: 'Heuristic: missing stop or target — R:R undefined.', flags }; }
    let s = rr >= 3 ? 95 : rr >= 2 ? 85 : rr >= 1.5 ? 72 : rr >= 1 ? 55 : 35;
    if (rr < 1.5) flags.push('weak_rr');
    return { score: s, rationale: `Heuristic: reward/risk ≈ ${rr.toFixed(2)}.`, flags };
  });
}

/** Underlying reward/risk from entry/stop/first target. */
export function rewardRisk(idea: TradeIdea): number | null {
  if (idea.entry == null || idea.stop == null || idea.targets.length === 0) return null;
  const target = idea.targets[0]!;
  const risk = Math.abs(idea.entry - idea.stop);
  const reward = Math.abs(target - idea.entry);
  if (risk <= 0) return null;
  return reward / risk;
}

/** Run all six lenses (in parallel) and return the factor map. */
export async function scoreAll(
  idea: TradeIdea,
  ctx: MarketContext,
): Promise<Record<FactorName, FactorScore>> {
  const [technical, joshLens, regime, news, optionsChain, riskReward] = await Promise.all([
    scoreTechnical(idea, ctx),
    scoreJoshLens(idea, ctx),
    scoreRegime(idea, ctx),
    scoreNews(idea, ctx),
    scoreOptionsChain(idea, ctx),
    scoreRiskReward(idea, ctx),
  ]);
  return { technical, joshLens, regime, news, optionsChain, riskReward };
}
