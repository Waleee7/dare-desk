// Alpha Vantage News & Sentiment — free backup feed (broad coverage + AI
// sentiment). GET https://www.alphavantage.co/query?function=NEWS_SENTIMENT

import type { NewsItem, NewsProvider } from './provider.js';
import { config } from '../lib/config.js';

interface AVRow { title: string; source?: string; url?: string; time_published?: string; }

export class AlphaVantageNews implements NewsProvider {
  readonly name = 'alphavantage-news';
  async getHeadlines(symbols: string[], limit: number): Promise<NewsItem[]> {
    const tickers = symbols.length ? `&tickers=${encodeURIComponent(symbols.slice(0, 5).join(','))}` : '';
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&limit=${limit}${tickers}&apikey=${config.alphaVantageKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`AlphaVantage news HTTP ${res.status}`);
    const data = (await res.json()) as { feed?: AVRow[] };
    return (data.feed ?? []).slice(0, limit).map((n) => ({
      headline: n.title,
      source: n.source || 'AlphaVantage',
      url: n.url || '',
      at: n.time_published || '',
      symbols: [],
    }));
  }
}
