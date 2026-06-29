// Market-data provider interface. The scanner reads real-time bars/quotes for
// the underlying through this; swap implementations (Mock now, Alpaca/broker
// next) without touching scan logic. Setups fire off the UNDERLYING in real
// time; real-time option-contract pricing comes from the broker feed (Phase 2).

export interface Bar {
  t: number; // epoch ms (bar open time)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Quote {
  symbol: string;
  price: number;
  t: number; // epoch ms
}

export type BarTimeframe = '1Min' | '5Min' | '15Min' | '1Day';

export interface MarketDataProvider {
  readonly name: string;
  readonly realtime: boolean;
  /** Recent bars, oldest first, most recent last. */
  getBars(symbol: string, timeframe: BarTimeframe, limit: number): Promise<Bar[]>;
  getQuote(symbol: string): Promise<Quote>;
}
