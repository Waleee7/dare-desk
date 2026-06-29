// Alpaca market-data adapter — free, real-time IEX feed for the underlyings
// (SPY/QQQ/MU etc.), the data that drives setup detection. Robinhood has no
// data API, so this is the live feed; RH stays the execution path.
//
// Get free keys at alpaca.markets → drop ALPACA_API_KEY + ALPACA_SECRET in .env.
// One documented endpoint (/v2/stocks/bars); the latest price is the last bar's
// close, so we don't depend on a second endpoint shape.

import type { Bar, Quote, BarTimeframe, MarketDataProvider } from './provider.js';
import { config } from '../lib/config.js';

const BASE = 'https://data.alpaca.markets';

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number; }

export class AlpacaMarketData implements MarketDataProvider {
  readonly name = 'alpaca';
  readonly realtime = true;

  private headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': config.alpaca.key,
      'APCA-API-SECRET-KEY': config.alpaca.secret,
    };
  }

  async getBars(symbol: string, timeframe: BarTimeframe, limit: number): Promise<Bar[]> {
    const url = `${BASE}/v2/stocks/bars?symbols=${encodeURIComponent(symbol)}`
      + `&timeframe=${timeframe}&limit=${limit}&feed=${config.alpaca.feed}&adjustment=raw`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Alpaca bars ${symbol} → HTTP ${res.status}`);
    const data = (await res.json()) as { bars?: Record<string, AlpacaBar[]> };
    const raw = data.bars?.[symbol] ?? [];
    return raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const bars = await this.getBars(symbol, '1Min', 1);
    const last = bars[bars.length - 1];
    return { symbol, price: last?.c ?? 0, t: last?.t ?? Date.now() };
  }
}
