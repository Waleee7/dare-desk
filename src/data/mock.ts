// Mock market data — deterministic per-symbol random walk so the scanner and
// demo run offline with stable, plausible bars. Real providers (Alpaca, broker
// feed) implement the same MarketDataProvider interface.

import type { Bar, Quote, BarTimeframe, MarketDataProvider } from './provider.js';

const BASE: Record<string, number> = {
  SPY: 580, QQQ: 505, MU: 110, AAPL: 225, MSFT: 470, NVDA: 140,
  AMD: 165, TSLA: 250, AMZN: 195, META: 600, GOOGL: 180, NFLX: 700,
};

// Per-symbol intraday drift bias (creates varied setups across the universe).
function seedFor(symbol: string): number {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Tiny seeded LCG for reproducible "random" walks. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export class MockMarketData implements MarketDataProvider {
  readonly name = 'mock';
  readonly realtime = false;

  async getBars(symbol: string, timeframe: BarTimeframe, limit: number): Promise<Bar[]> {
    const base = BASE[symbol] ?? 100;
    const TF_SEED: Record<BarTimeframe, number> = { '1Min': 1, '5Min': 2, '15Min': 4, '1Hour': 5, '4Hour': 6, '1Day': 3 };
    const seed = seedFor(symbol) ^ TF_SEED[timeframe];
    const rand = lcg(seed);
    const drift = ((seed % 7) - 3) / 1000; // -0.003..+0.003 per bar
    const vol = base * 0.0015;

    const STEP_MS: Record<BarTimeframe, number> = {
      '1Min': 60_000, '5Min': 300_000, '15Min': 900_000,
      '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000,
    };
    const stepMs = STEP_MS[timeframe];
    const now = Date.now();
    const bars: Bar[] = [];
    let price = base * (1 - drift * limit * 0.5); // start so the walk lands near base
    for (let i = limit - 1; i >= 0; i--) {
      const o = price;
      const move = (rand() - 0.5) * 2 * vol + drift * base;
      const c = Math.max(1, o + move);
      const h = Math.max(o, c) + rand() * vol;
      const l = Math.min(o, c) - rand() * vol;
      const v = Math.round(500_000 + rand() * 2_000_000);
      bars.push({ t: now - i * stepMs, o, h, l, c, v });
      price = c;
    }
    return bars;
  }

  async getQuote(symbol: string): Promise<Quote> {
    // Same walk the scanner sees (limit changes the LCG sequence) — a quote that
    // disagrees with its own bars would false-trigger the chase guard on mock data.
    const bars = await this.getBars(symbol, '1Min', 60);
    return { symbol, price: bars[bars.length - 1]?.c ?? BASE[symbol] ?? 100, t: Date.now() };
  }
}
