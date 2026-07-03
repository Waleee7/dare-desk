// Component 3 — Signal Grade Judge (Strategy Edge Governor). Weights the six lenses
// into a 0-100 total, caps it into an EARNED confidence %, and assigns a letter grade.
// A+ >= 90 (lean-in; the Extended-universe bar) · A >= 80 (fires) · B >= 70 (watch) ·
// C >= 60 (watch/log) · D < 60 (no-trade). One honest number: confidence can't exceed
// what real confluence backs, so the top of the range only shows when market regime
// (and more) actually agree — never technicals alone. A+ requires regime + news/MTF.

import type {
  TradeIdea, FactorScore, FactorName, ScoreBreakdown, GovernorDecision, Grade,
} from '../lib/types.js';
import { WEIGHTS, GRADE_THRESHOLDS, config } from '../lib/config.js';
import { htfAgrees, fightsHtf } from '../context/trend.js';
import { CONTINUATION_SETUP } from '../context/dayType.js';
import type { MarketContext } from '../lib/types.js';

/** Tape conditions the governor may factor in (all optional — pure without them). */
export interface GovernContext {
  dayType?: MarketContext['dayType'];
  etMin?: number; // minutes past ET midnight at decision time
}

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
  ctx: GovernContext = {},
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

  const { confidence, capNotes } = earnedConfidence(total, factors, idea, ctx);

  const breakdown: ScoreBreakdown = { factors, total, confidence, confluenceCount };
  const grade = gradeFor(confidence);
  const reasons = [...explain(factors, grade, confluenceCount, total, confidence), ...capNotes];

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
  ctx: GovernContext,
): { confidence: number; capNotes: string[] } {
  const capNotes: string[] = [];
  const regimeAgree = factors.regime.score >= AGREE;
  // News must be a REAL catalyst (>=75) to help unlock the top of the range — a
  // quiet no-event tape scores ~65 and is neutral, not confirmation. Without this
  // the A+ bar quietly degrades to "regime alone", which is not the design.
  const newsAgree = factors.news.score >= 75;
  // Chain only "agrees" if we actually verified it — an unscoreable chain can't
  // unlock the top of the range (so missing options data caps confidence at 95).
  // A DELAYED free chain counts modestly in the weighted total but must NOT unlock the
  // top of the range — only a real (priced) chain is full confirmation.
  const chainAgree = isScoreable(factors.optionsChain)
    && factors.optionsChain.score >= AGREE
    && !factors.optionsChain.flags.includes('chain_delayed');
  const mtfStrong = !!idea.mtf && idea.mtf.agreement >= 2 && !idea.mtf.conflict;
  // Higher-timeframe stack (15m/1h/4h/1D): agreement is real confirmation and can
  // help unlock the top of the range; FIGHTING an aligned stack is the classic
  // 0/10 loser — it can never fire, whatever the intraday chart says.
  const htfStrong = !!idea.trend && htfAgrees(idea.trend, idea.direction);
  const htfFight = !!idea.trend && fightsHtf(idea.trend, idea.direction);

  let ceiling = 82; // clean technical setup, alone → tops out at B (can't fire)
  if (regimeAgree) ceiling = 90; // + market regime backs it → CAN reach A (fires)
  if (regimeAgree && (newsAgree || mtfStrong || htfStrong)) ceiling = 95; // + catalyst / multi-TF / HTF stack → A+
  if (regimeAgree && newsAgree && chainAgree) ceiling = 100; // full confluence
  if (htfFight) {
    ceiling = Math.min(ceiling, 78); // against an aligned HTF stack → watch at best
    capNotes.push('Fighting the aligned higher-timeframe stack — watch-only, whatever the intraday chart says.');
  }

  // Day-character caps — WATCH, not delete: the setup still posts to the watch
  // feed, it just can't fire into conditions that statistically shred it.
  if (ctx.dayType === 'range' && CONTINUATION_SETUP.test(idea.setup)) {
    ceiling = Math.min(ceiling, 78);
    capNotes.push('Range/chop day — breakout & continuation plays demoted to watch until the tape proves trend.');
  }
  const guard = config.risk.openingGuardMin;
  if (guard > 0 && ctx.etMin != null && ctx.etMin >= 570 && ctx.etMin < 570 + guard) {
    ceiling = Math.min(ceiling, 78);
    capNotes.push(`First ${guard} minutes — spreads are widest and the range hasn't formed; watch-only.`);
  }

  return { confidence: Math.max(0, Math.min(total, ceiling)), capNotes };
}

function gradeFor(confidence: number): Grade {
  if (confidence >= GRADE_THRESHOLDS.APLUS) return 'A+';
  if (confidence >= GRADE_THRESHOLDS.A) return 'A';
  if (confidence >= GRADE_THRESHOLDS.B) return 'B';
  if (confidence >= GRADE_THRESHOLDS.C) return 'C';
  return 'D';
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
  if (grade === 'A+') reasons.push(`≥${GRADE_THRESHOLDS.APLUS}% earned confidence — A+, lean in.`);
  if (grade === 'A') reasons.push(`≥${GRADE_THRESHOLDS.A}% earned confidence — A, fires as a signal.`);
  if (grade === 'D') reasons.push(`Below ${GRADE_THRESHOLDS.C}% — D, no-trade, respected downstream.`);
  return reasons;
}

const LABELS: Record<FactorName, string> = {
  technical: 'Technical', joshLens: 'Josh-lens', regime: 'Regime',
  news: 'News', optionsChain: 'Chain', riskReward: 'R:R',
};
const label = (f: FactorName) => LABELS[f];
