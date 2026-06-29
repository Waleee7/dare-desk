// Provider factory: real Alpaca feed when keys are present, else the offline
// mock so the scanner/dashboard always run.

import type { MarketDataProvider } from './provider.js';
import { MockMarketData } from './mock.js';
import { AlpacaMarketData } from './alpaca.js';
import { config } from '../lib/config.js';

export function makeProvider(): MarketDataProvider {
  if (config.alpaca.key && config.alpaca.secret) return new AlpacaMarketData();
  return new MockMarketData();
}

export type { MarketDataProvider } from './provider.js';
