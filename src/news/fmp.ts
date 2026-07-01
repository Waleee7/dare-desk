// Financial Modeling Prep (FMP) — free, verified stock news.
// GET https://financialmodelingprep.com/api/v3/stock_news?apikey=KEY
// The optional `tickers` param scopes to the watched symbols and each row's
// `symbol` populates NewsItem.symbols. Key-guarded + never-throws (returns []).

import type { NewsItem, NewsProvider } from './provider.js';
import { config } from '../lib/config.js';

interface FMPRow { title?: string; site?: string; url?: string; publishedDate?: string; symbol?: string; }

export class FMPNews implements NewsProvider {
  readonly name = 'fmp-news';

  async getHeadlines(symbols: string[], limit: number): Promise<NewsItem[]> {
    if (!config.fmpKey) return []; // key-guard
    try {
      const tickers = symbols.length ? `&tickers=${encodeURIComponent(symbols.slice(0, 10).join(','))}` : '';
      const url = `https://financialmodelingprep.com/api/v3/stock_news?limit=${limit}${tickers}&apikey=${config.fmpKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      const rows: FMPRow[] = Array.isArray(data) ? (data as FMPRow[]) : [];
      return rows.slice(0, limit).map((n) => ({
        headline: n.title ?? '',
        source: n.site || 'FMP',
        url: n.url || '',
        // FMP publishedDate is a local wall-clock string (ambiguous tz) — pass it
        // through verbatim rather than inventing a UTC offset.
        at: n.publishedDate || '',
        symbols: n.symbol ? [n.symbol] : [],
      }));
    } catch {
      return []; // never throw — the chain moves on to the next feed
    }
  }
}
