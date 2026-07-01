// News provider factory + a fallback chain so the bot is never down on one
// flaky feed: Alpaca (primary) → Alpha Vantage (backup) → empty (never throws).

import type { NewsItem, NewsProvider } from './provider.js';
import { AlpacaNews } from './alpaca.js';
import { AlphaVantageNews } from './alphavantage.js';
import { FinnhubNews } from './finnhub.js';
import { FMPNews } from './fmp.js';
import { config } from '../lib/config.js';

class StubNews implements NewsProvider {
  readonly name = 'none';
  async getHeadlines(): Promise<NewsItem[]> { return []; }
}

/** Ordered providers to try (first with creds wins, rest are fallbacks). */
function chain(): NewsProvider[] {
  const c: NewsProvider[] = [];
  if (config.alpaca.key && config.alpaca.secret) c.push(new AlpacaNews());
  if (config.alphaVantageKey) c.push(new AlphaVantageNews());
  if (config.finnhubKey) c.push(new FinnhubNews());
  if (config.fmpKey) c.push(new FMPNews());
  if (c.length === 0) c.push(new StubNews());
  return c;
}

export function newsProviderName(): string {
  return chain().map((p) => p.name).join(' → ');
}

/** Best-effort headlines across the fallback chain. Never throws. */
export async function getVerifiedHeadlines(symbols: string[], limit = 8): Promise<NewsItem[]> {
  for (const p of chain()) {
    try {
      const items = await p.getHeadlines(symbols, limit);
      if (items.length) return items;
    } catch {
      // try the next provider
    }
  }
  return [];
}

export type { NewsItem, NewsProvider } from './provider.js';
