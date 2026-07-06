// ReplayMarketDataProvider — feeds history to the LIVE pipeline with NO lookahead
// by construction. It holds pre-fetched bars per (symbol, timeframe) and, on every
// getBars/getQuote, returns only bars whose open time is <= the current virtual
// clock. Advance the clock, the same Scanner/engine/exit-monitor see the next slice
// of history exactly as they would have live. Because it reuses the real pipeline
// verbatim, replay results actually predict live behavior.

import type { Bar, Quote, BarTimeframe, MarketDataProvider } from '../data/provider.js';

export type BarStore = Record<string, Partial<Record<BarTimeframe, Bar[]>>>;

export class ReplayMarketDataProvider implements MarketDataProvider {
  readonly name: string;
  readonly realtime = true; // replay = "as if live" (so chain-anchoring/quotes engage)
  private virtualNowMs = 0;

  /** `store[symbol][timeframe]` = full history, ascending by bar-open time. */
  constructor(private readonly store: BarStore, sourceName = 'replay') {
    this.name = sourceName;
    // Defensive: ensure every series is sorted ascending (binary search relies on it).
    for (const sym of Object.keys(store)) {
      for (const tf of Object.keys(store[sym]!) as BarTimeframe[]) {
        store[sym]![tf]!.sort((a, b) => a.t - b.t);
      }
    }
  }

  /** Move the virtual clock. All subsequent reads reflect only bars <= this instant. */
  setNow(ms: number): void { this.virtualNowMs = ms; }
  now(): number { return this.virtualNowMs; }

  /** The full span of history available (min open .. max open across all series). */
  span(): { startMs: number; endMs: number } {
    let start = Infinity;
    let end = -Infinity;
    for (const sym of Object.keys(this.store)) {
      for (const tf of Object.keys(this.store[sym]!) as BarTimeframe[]) {
        const arr = this.store[sym]![tf]!;
        if (arr.length) { start = Math.min(start, arr[0]!.t); end = Math.max(end, arr[arr.length - 1]!.t); }
      }
    }
    return { startMs: start === Infinity ? 0 : start, endMs: end === -Infinity ? 0 : end };
  }

  async getBars(symbol: string, timeframe: BarTimeframe, limit: number): Promise<Bar[]> {
    const series = this.store[symbol.toUpperCase()]?.[timeframe] ?? [];
    // Last index whose open time is <= virtualNow (no future bar ever leaks).
    const end = upperBound(series, this.virtualNowMs);
    if (end <= 0) return [];
    const start = Math.max(0, end - limit);
    return series.slice(start, end);
  }

  async getQuote(symbol: string): Promise<Quote> {
    // The quote = the close of the most recent bar the finest series has produced
    // by virtualNow, mirroring how AlpacaMarketData derives its quote.
    const bars = await this.getBars(symbol, '1Min', 1);
    const last = bars[bars.length - 1];
    return { symbol: symbol.toUpperCase(), price: last?.c ?? 0, t: last?.t ?? this.virtualNowMs };
  }
}

/** First index i such that series[i].t > nowMs (i.e. count of bars at-or-before now). */
function upperBound(series: Bar[], nowMs: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.t <= nowMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
