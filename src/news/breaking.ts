// Breaking-news watcher — turns the polled headline feed into ALERTS instead of
// scenery. Each tick it diffs fresh verified headlines against what it has seen;
// genuinely new, high-impact ones go to the #news channel and into the dashboard.
// The first pass PRIMES silently (no flood of stale headlines on startup), and a
// seen-set persists to data/news-seen.json so restarts don't re-alert old news.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { NewsItem } from './provider.js';
import { getVerifiedHeadlines } from './index.js';

/** Headlines that can actually move a name — worth an alert, not just context. */
const HIGH_IMPACT = new RegExp(
  [
    'upgrade', 'downgrade', 'price target', 'initiat',
    'guidance', 'raises', 'cuts', 'beats', 'misses', 'warns',
    'halt', 'halted', 'sec ', 'doj', 'investigat', 'probe', 'lawsuit', 'subpoena',
    'acqui', 'merger', 'buyout', 'takeover', 'stake',
    'fda', 'approval', 'recall',
    'bankrupt', 'default', 'layoff',
    'partnership', 'contract award', 'wins contract',
    'split', 'dividend', 'buyback', 'offering', 'dilut',
    'breaking',
  ].join('|'),
  'i',
);

const keyOf = (n: NewsItem): string => (n.url || `${n.source}:${n.headline}`).slice(0, 300);

export class BreakingNewsWatcher {
  private seen = new Set<string>();
  private primed = false;

  constructor(private readonly filePath = join(process.cwd(), 'data', 'news-seen.json')) {
    this.load();
  }

  /**
   * One pass: fetch fresh verified headlines for the universe, return the ones
   * that are NEW since last look. `all` = every new item (dashboard feed);
   * `breaking` = the high-impact subset (Discord #news alerts, capped by caller).
   * Never throws — a feed hiccup returns empty.
   */
  async check(symbols: string[], limit = 25): Promise<{ all: NewsItem[]; breaking: NewsItem[] }> {
    const items = await getVerifiedHeadlines(symbols, limit).catch(() => [] as NewsItem[]);
    if (!items.length) return { all: [], breaking: [] };

    // First pass with an empty memory: prime silently — never flood old news.
    if (!this.primed && this.seen.size === 0) {
      for (const n of items) this.seen.add(keyOf(n));
      this.primed = true;
      this.save();
      return { all: [], breaking: [] };
    }
    this.primed = true;

    const fresh = items.filter((n) => !this.seen.has(keyOf(n)));
    if (!fresh.length) return { all: [], breaking: [] };
    for (const n of fresh) this.seen.add(keyOf(n));
    // Cap the memory — a season of headlines, not a lifetime.
    if (this.seen.size > 3000) this.seen = new Set([...this.seen].slice(-2000));
    this.save();

    return { all: fresh, breaking: fresh.filter((n) => HIGH_IMPACT.test(n.headline)) };
  }

  /** Discord-ready one-liner for a breaking item. */
  static render(n: NewsItem): string {
    const tickers = n.symbols?.length ? ` [${n.symbols.slice(0, 3).join(' ')}]` : '';
    return `📰 **BREAKING${tickers}** — ${n.headline} · _${n.source}_${n.url ? `\n${n.url}` : ''}`;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as string[];
      if (Array.isArray(data)) { this.seen = new Set(data); this.primed = this.seen.size > 0; }
    } catch { /* fresh start */ }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.seen]), 'utf8');
    } catch { /* best-effort */ }
  }
}
