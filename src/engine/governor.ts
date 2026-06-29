// Component 3 — Strategy Edge Governor. Weights the six lenses into a 0-100
// total, caps it into an EARNED confidence %, and assigns a grade.
// SIGNAL >= 85% (fires) · WATCH 65-84% (observe) · REJECT < 65%. No-trade is final.
// One honest number: confidence can't exceed what real confluence backs, so 85%
// only shows when market regime (and more) actually agree — never technicals alone.

import type {
  TradeIdea, FactorScore, FactorName, ScoreBreakdown, GovernorDecision, Grade,
} from '../lib/types.js';
import { WEIGHTS, GRADE_THRESHOLDS } from '../lib/config.js';

const AGREE = 60; // a factor "materially agrees" at >= 60 on its axis

// Factors we genuinely can't measure yet (flagged here) are dropped from the
// weighted total and renormalized away — a disclosed data gap shouldn't drag a
// good setup down. The confidence CEILING still withholds the top of the range
// for the missing confirmation, so this stays honest, not generous.
const UNSCOREABLE_FLAGS = new Set<string>(['chain_unverified']);
const isScoreable = (f: FactorScore): boolean => !f.flags.some((fl) => UNSCOREABLE_FLAGS.has(fl));

export function governDecision(
  idea: TradeIdea,
  factors: Record<FactorName, FactorScore>,
): GovernorDecision {
  // Weighted total over the factors we can actually measure: drop unscoreable
  // ones (e.g. no live options chain) and renormalize the remaining weights.
  const names = Object.keys(WEIGHTS) as FactorName[];
  const activeNames = names.filter((n) => isScoreable(factors[n]));
  const activeWeight = activeNames.reduce((sum, n) => sum + WEIGHTS[n], 0) || 1;
  let total = 0;
  for (const name of activeNames) {
    total += (factors[name].score / 100) * (WEIGHTS[name] / activeWeight) * 100;
  }
  total = Math.round(total);

  // Confluence counts only factors we can actually measure (don't credit a gap).
  const confluenceCount = activeNames.filter((n) => factors[n].score >= AGREE).length;

  const confidence = earnedConfidence(total, factors, idea);

  const breakdown: ScoreBreakdown = { factors, total, confidence, confluenceCount };
  const grade = gradeFor(confidence);
  const reasons = explain(factors, grade, confluenceCount, total, confidence);

  return { grade, total, confidence, breakdown, reasons };
}

/**
 * Earned confidence 0-100. Starts from the weighted total, then CAPS it by how
 * much real confluence backs the trade — so a clean-looking chart alone can't
 * claim a signal. The market regime must agree before confidence can clear 85%
 * (SIGNAL); news + multi-timeframe agreement (and, when we have it, a clean
 * options chain) unlock the top of the range. This is the honesty knob.
 */
function earnedConfidence(
  total: number,
  factors: Record<FactorName, FactorScore>,
  idea: TradeIdea,
): number {
  const regimeAgree = factors.regime.score >= AGREE;
  const newsAgree = factors.news.score >= AGREE;
  // Chain only "agrees" if we actually verified it — an unscoreable chain can't
  // unlock the top of the range (so missing options data caps confidence at 95).
  const chainAgree = isScoreable(factors.optionsChain) && factors.optionsChain.score >= AGREE;
  const mtfStrong = !!idea.mtf && idea.mtf.agreement >= 2 && !idea.mtf.conflict;

  let ceiling = 82; // clean technical setup, alone → tops out at WATCH (can't fire)
  if (regimeAgree) ceiling = 90; // + market regime backs it → CAN reach SIGNAL
  if (regimeAgree && (newsAgree || mtfStrong)) ceiling = 95; // + catalyst or multi-TF
  if (regimeAgree && newsAgree && chainAgree) ceiling = 100; // full confluence

  return Math.max(0, Math.min(total, ceiling));
}

function gradeFor(confidence: number): Grade {
  if (confidence >= GRADE_THRESHOLDS.SIGNAL) return 'SIGNAL';
  if (confidence >= GRADE_THRESHOLDS.WATCH) return 'WATCH';
  return 'REJECT';
}

function explain(
  factors: Record<FactorName, FactorScore>,
  grade: Grade,
  confluence: number,
  total: number,
  confidence: number,
): string[] {
  const arr = Object.values(factors) as FactorScore[];
  const strong = arr.filter((f) => f.score >= 70).map((f) => `${label(f.factor)} strong (${f.score})`);
  const weak = arr.filter((f) => f.score < 50).map((f) => `${label(f.factor)} weak (${f.score})`);
  const reasons: string[] = [];
  if (strong.length) reasons.push(strong.slice(0, 3).join('; '));
  if (weak.length) reasons.push(`Drags: ${weak.slice(0, 3).join('; ')}`);
  reasons.push(`${confluence}/6 factors in agreement`);
  // Surface WHY a strong-looking score didn't earn a higher confidence.
  if (confidence < total - 1) {
    reasons.push(`Confidence held to ${confidence}% (raw ${total}) — not enough confluence backing it (regime/news/MTF).`);
  }
  if (grade === 'SIGNAL') reasons.push('≥85% earned confidence — fires as a signal.');
  if (grade === 'REJECT') reasons.push('Below 65% — no-trade, respected downstream.');
  return reasons;
}

const LABELS: Record<FactorName, string> = {
  technical: 'Technical', joshLens: 'Josh-lens', regime: 'Regime',
  news: 'News', optionsChain: 'Chain', riskReward: 'R:R',
};
const label = (f: FactorName) => LABELS[f];
