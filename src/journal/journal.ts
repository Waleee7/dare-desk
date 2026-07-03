// Component 7 — Trade Journal Memory. Records every alert, skip, fill, and result
// with mistake tags + rule-improvement ideas, plus the entry ticket (tier, entry
// time, modeled fill/cost) and a closed-trade store that feeds R-multiple
// expectancy (the evidence behind the prove-it gate).

import type {
  TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, BrokerResult,
  ClosedTrade, ExpectancyStats, Tier,
} from '../lib/types.js';
import { computeExpectancy } from '../backtest/index.js';
import { config } from '../lib/config.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

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
  // Entry ticket (present when a fill occurred).
  tier?: Tier;
  entryTimeEt?: string;
  fillPremium?: number;
  costPaidUsd?: number | null;
  exitTimeframe?: string;
  joshNote?: string;
  mistakeTags: MistakeTag[];
  ruleIdea?: string;
}

export class TradeJournal {
  private entries: JournalEntry[] = [];
  private closed: ClosedTrade[] = [];
  private readonly entriesPath: string | null;
  private readonly closedPath: string | null;

  /** Pass a dataDir to make the journal PERSISTENT (data/journal.json +
   *  data/closed.json). Without persistence every restart wiped expectancy and
   *  reset the 100-trade prove-it counter — the gate was unreachable. Omit for
   *  throwaway engines (tests, one-shot CLI). */
  constructor(dataDir?: string) {
    this.entriesPath = dataDir ? join(dataDir, 'journal.json') : null;
    this.closedPath = dataDir ? join(dataDir, 'closed.json') : null;
    this.load();
  }

  record(
    idea: TradeIdea,
    decision: GovernorDecision,
    fw: FirewallResult,
    alert: PremiumFloorAlert,
    broker: BrokerResult | null,
  ): JournalEntry {
    const outcome: JournalEntry['outcome'] = !fw.approved
      ? 'skipped'
      : decision.grade === 'B' ? 'watch' : 'alerted';

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
      tier: alert.tier,
      entryTimeEt: alert.entryTimeEt,
      fillPremium: broker?.fillPremium,
      costPaidUsd: alert.costPaidUsd,
      exitTimeframe: alert.timeToFlat,
      mistakeTags: tagFrom(fw, decision),
      ruleIdea: ruleIdeaFrom(fw, decision),
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  /** Record a MODELED paper close — the unit expectancy is computed from. R is
   *  measured against the modeled premium stop. All fills MODELED (no live chain). */
  closeTrade(t: {
    ticker: string; setup: string; tier: Tier;
    entryTimeEt: string; exitTimeEt: string;
    fillPremium: number; exitPremium: number; contracts: number;
    costPaidUsd: number; stopPremium: number;
    regime: 'up' | 'down' | 'flat';
  }): ClosedTrade {
    // Round-trip commissions come off the top — on small 0DTE lots the fixed fee
    // is 2-5% of premium per round trip, enough to flip a thin edge negative.
    // (TP1-scaled positions actually pay three legs; two is the honest floor.)
    const commissions = round2(config.fills.commissionPerContract * t.contracts * 2);
    const pnlUsd = round2((t.exitPremium - t.fillPremium) * 100 * t.contracts - commissions);
    const riskUsd = Math.max(1, (t.fillPremium - t.stopPremium) * 100 * t.contracts);
    const rMultiple = round2(pnlUsd / riskUsd);
    const ct: ClosedTrade = {
      ticker: t.ticker, setup: t.setup, tier: t.tier,
      entryTimeEt: t.entryTimeEt, exitTimeEt: t.exitTimeEt,
      fillPremium: t.fillPremium, exitPremium: t.exitPremium, contracts: t.contracts,
      costPaidUsd: t.costPaidUsd, pnlUsd, rMultiple,
      holdMinutes: holdMinutesBetween(t.entryTimeEt, t.exitTimeEt),
      result: pnlUsd >= 0 ? 'win' : 'loss', regime: t.regime,
    };
    this.closed.push(ct);
    this.save();
    return ct;
  }

  // --- persistence (best-effort) --------------------------------------------------

  private load(): void {
    const read = <T>(path: string | null): T[] => {
      if (!path || !existsSync(path)) return [];
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as T[];
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    };
    this.entries = read<JournalEntry>(this.entriesPath);
    this.closed = read<ClosedTrade>(this.closedPath);
  }

  private save(): void {
    try {
      if (this.entriesPath) {
        mkdirSync(dirname(this.entriesPath), { recursive: true });
        // Cap the on-disk journal — expectancy needs closed trades, not every scan row.
        writeFileSync(this.entriesPath, JSON.stringify(this.entries.slice(-2000), null, 2), 'utf8');
      }
      if (this.closedPath) {
        mkdirSync(dirname(this.closedPath), { recursive: true });
        writeFileSync(this.closedPath, JSON.stringify(this.closed, null, 2), 'utf8');
      }
    } catch { /* never let a disk hiccup kill a trade record in memory */ }
  }

  /** Attach Josh's own read to the most recent entry (his discretionary edge). */
  annotate(joshNote: string): void {
    const last = this.entries[this.entries.length - 1];
    if (last) last.joshNote = joshNote;
  }

  all(): readonly JournalEntry[] { return this.entries; }
  closedTrades(): readonly ClosedTrade[] { return this.closed; }

  /** R-multiple expectancy over closed paper trades — feeds prove-it + EOD recap. */
  expectancy(): ExpectancyStats { return computeExpectancy(this.closed); }

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

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Minutes between two "HH:MM:SS" ET stamps (same session; wraps defensively). */
function holdMinutesBetween(a: string, b: string): number {
  const toMin = (s: string): number => {
    const parts = s.split(':').map(Number);
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0) + (parts[2] ?? 0) / 60;
  };
  const d = toMin(b) - toMin(a);
  return round2(d >= 0 ? d : d + 24 * 60);
}

function tagFrom(fw: FirewallResult, decision: GovernorDecision): MistakeTag[] {
  const tags: MistakeTag[] = [];
  if (fw.blocks.some((b) => b.startsWith('no_clear_stop'))) tags.push('no_stop');
  if (fw.blocks.some((b) => b.includes('spread'))) tags.push('bad_contract');
  if (fw.blocks.some((b) => b.includes('regime'))) tags.push('ignored_regime');
  if (fw.blocks.some((b) => b.includes('event'))) tags.push('ignored_news');
  if (fw.blocks.some((b) => b.includes('overtrading'))) tags.push('overtrade');
  if (fw.blocks.some((b) => b.includes('name_cooldown'))) tags.push('revenge_trade');
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
