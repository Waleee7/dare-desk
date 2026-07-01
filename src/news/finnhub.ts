// Finnhub — free, verified news. Market news:
// GET https://finnhub.io/api/v1/news?category=general&token=KEY
// When symbols are given, the company-news endpoint tags each item's ticker so
// NewsItem.symbols is populated. Key-guarded + never-throws (returns []).

import type { NewsItem, NewsProvider } from './provider.js';
import { config } from '../lib/config.js';

interface FinnhubRow { headline?: string; source?: string; url?: string; datetime?: number; related?: string; }

// Finnhub `datetime` is unix SECONDS (unambiguous UTC) — convert faithfully to ISO.
const isoFromUnix = (secs?: number): string =>
  typeof secs === 'number' && Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : '';

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export class FinnhubNews implements NewsProvider {
  readonly name = 'finnhub-news';

  async getHeadlines(symbols: string[], limit: number): Promise<NewsItem[]> {
    if (!config.finnhubKey) return []; // key-guard
    try {
      const rows = symbols.length ? await this.companyNews(symbols) : await this.marketNews();
      return rows.slice(0, limit).map((n) => ({
        headline: n.headline ?? '',
        source: n.source || 'Finnhub',
        url: n.url || '',
        at: isoFromUnix(n.datetime),
        symbols: n.related ? [n.related] : [],
      }));
    } catch {
      return []; // never throw — the chain moves on to the next feed
    }
  }

  private async marketNews(): Promise<FinnhubRow[]> {
    const url = `https://finnhub.io/api/v1/news?category=general&token=${config.finnhubKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as FinnhubRow[]) : [];
  }

  // Per-symbol company news (last 7 days) → each item tagged with its ticker.
  private async companyNews(symbols: string[]): Promise<FinnhubRow[]> {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const out: FinnhubRow[] = [];
    for (const sym of symbols.slice(0, 5)) {
      const url =
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}` +
        `&from=${ymd(from)}&to=${ymd(to)}&token=${config.finnhubKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;
      for (const r of data as FinnhubRow[]) out.push({ ...r, related: r.related || sym });
    }
    return out;
  }
}
