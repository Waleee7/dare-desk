// Alpaca News API — free, real-time Benzinga feed (same keys as the data feed).
// GET https://data.alpaca.markets/v1beta1/news

import type { NewsItem, NewsProvider } from './provider.js';
import { config } from '../lib/config.js';

interface AlpacaNewsRow { headline: string; source?: string; url?: string; created_at?: string; symbols?: string[]; }

export class AlpacaNews implements NewsProvider {
  readonly name = 'alpaca-news';
  async getHeadlines(symbols: string[], limit: number): Promise<NewsItem[]> {
    const q = symbols.length ? `&symbols=${encodeURIComponent(symbols.slice(0, 10).join(','))}` : '';
    const res = await fetch(`https://data.alpaca.markets/v1beta1/news?limit=${limit}&sort=desc${q}`, {
      headers: { 'APCA-API-KEY-ID': config.alpaca.key, 'APCA-API-SECRET-KEY': config.alpaca.secret },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Alpaca news HTTP ${res.status}`);
    const data = (await res.json()) as { news?: AlpacaNewsRow[] };
    return (data.news ?? []).map((n) => ({
      headline: n.headline,
      source: n.source || 'Benzinga',
      url: n.url || '',
      at: n.created_at || '',
      symbols: n.symbols || [],
    }));
  }
}
