// Component 7 — Trade Journal Memory. Records every alert, skip, fill, and
// result with mistake tags + rule-improvement ideas, so the bot learns from
// what it did AND what it skipped (feeds the missed-trade-learning-lab skill).

import type {
  TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, BrokerResult,
} from '../lib/types.js';

export type MistakeTag =
  | 'late_entry' | 'early_exit' | 'no_stop' | 'bad_contract' | 'ignored_regime'
  | 'ignored_news' | 'overtrade' | 'revenge_trade' | 'false_breakout'
  | 'valid_loss' | 'great_skip' | 'missed_winner';

export interface JournalEntry {
  at: string; // ISO
  ticker: string;
  setup: string;
  grade: string;
  total: number;
  confidence: number;
  outcome: 'alerted' | 'watch' | 'skipped';
  approved: boolean;
  blocks: string[];
  brokerMessage: string;
  joshNote?: string;
  mistakeTags: MistakeTag[];
  ruleIdea?: string;
}

export class TradeJournal {
  private entries: JournalEntry[] = [];

  record(
    idea: TradeIdea,
    decision: GovernorDecision,
    fw: FirewallResult,
    alert: PremiumFloorAlert,
    broker: BrokerResult | null,
  ): JournalEntry {
    const outcome: JournalEntry['outcome'] = !fw.approved
      ? 'skipped'
      : decision.grade === 'WATCH' ? 'watch' : 'alerted';

    const entry: JournalEntry = {
      at: new Date().toISOString(),
      ticker: idea.ticker,
      setup: idea.setup,
      grade: decision.grade,
      total: decision.total,
      confidence: decision.confidence,
      outcome,
      approved: fw.approved,
      blocks: fw.blocks,
      brokerMessage: broker?.message ?? '(no order placed)',
      mistakeTags: tagFrom(fw, decision),
      ruleIdea: ruleIdeaFrom(fw, decision),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Attach Josh's own read to the most recent entry (his discretionary edge). */
  annotate(joshNote: string): void {
    const last = this.entries[this.entries.length - 1];
    if (last) last.joshNote = joshNote;
  }

  all(): readonly JournalEntry[] { return this.entries; }

  summary(): { total: number; alerted: number; watched: number; skipped: number; topBlocks: string[] } {
    const counts = { alerted: 0, watched: 0, skipped: 0 };
    const blockTally = new Map<string, number>();
    for (const e of this.entries) {
      if (e.outcome === 'alerted') counts.alerted++;
      else if (e.outcome === 'watch') counts.watched++;
      else counts.skipped++;
      for (const b of e.blocks) {
        const key = b.split(' ')[0]!;
        blockTally.set(key, (blockTally.get(key) ?? 0) + 1);
      }
    }
    const topBlocks = [...blockTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`);
    return { total: this.entries.length, ...counts, topBlocks };
  }
}

function tagFrom(fw: FirewallResult, decision: GovernorDecision): MistakeTag[] {
  const tags: MistakeTag[] = [];
  if (fw.blocks.some((b) => b.startsWith('no_clear_stop'))) tags.push('no_stop');
  if (fw.blocks.some((b) => b.includes('spread'))) tags.push('bad_contract');
  if (fw.blocks.some((b) => b.includes('regime'))) tags.push('ignored_regime');
  if (fw.blocks.some((b) => b.includes('event'))) tags.push('ignored_news');
  if (fw.blocks.some((b) => b.includes('overtrading'))) tags.push('overtrade');
  // A disciplined skip of a weak idea is a good outcome, worth labeling.
  if (!fw.approved && decision.total < 55) tags.push('great_skip');
  return tags;
}

function ruleIdeaFrom(fw: FirewallResult, decision: GovernorDecision): string | undefined {
  if (decision.breakdown.confluenceCount < 2) return 'Require ≥2 agreeing factors before any alert (single-factor = noise).';
  if (fw.blocks.some((b) => b.includes('event'))) return 'Add a hard news-blackout window around earnings/CPI/FOMC.';
  if (fw.warnings.some((w) => w.includes('thin'))) return 'Add an open-interest floor to the chain filter.';
  return undefined;
}
