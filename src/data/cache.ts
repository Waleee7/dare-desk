// Per-tick memoizing wrapper around any MarketDataProvider. The scanner, trend
// engine, levels engine, market context, and exit monitor all read overlapping
// bars each tick — without a cache that's 3-4x duplicate requests against the
// free Alpaca tier (200 req/min). One fetch per (symbol, timeframe, limit) per
// TTL window; errors are NOT cached so a transient failure retries next call.

import type { Bar, Quote, BarTimeframe, MarketDataProvider } from './provider.js';

export class CachedMarketData implements MarketDataProvider {
  readonly name: string;
  readonly realtime: boolean;
  private bars = new Map<string, { at: number; data: Bar[] }>();
  private quotes = new Map<string, { at: number; data: Quote }>();

  constructor(
    private readonly inner: MarketDataProvider,
    private readonly ttlMs: number,
  ) {
    this.name = inner.name;
    this.realtime = inner.realtime;
  }

  async getBars(symbol: string, timeframe: BarTimeframe, limit: number): Promise<Bar[]> {
    const key = `${symbol}:${timeframe}:${limit}`;
    const hit = this.bars.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.ttlMs) return hit.data;
    const data = await this.inner.getBars(symbol, timeframe, limit);
    this.bars.set(key, { at: now, data });
    return data;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const hit = this.quotes.get(symbol);
    const now = Date.now();
    // Quotes drive exit decisions — keep them fresher than bars (min(ttl, 30s)).
    if (hit && now - hit.at < Math.min(this.ttlMs, 30_000)) return hit.data;
    const data = await this.inner.getQuote(symbol);
    this.quotes.set(symbol, { at: now, data });
    return data;
  }

  /** Drop everything (start of a new tick if you want hard freshness). */
  clear(): void {
    this.bars.clear();
    this.quotes.clear();
  }
}
