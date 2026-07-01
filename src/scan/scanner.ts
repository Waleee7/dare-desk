// The active scanner. Pulls real-time bars for the universe, runs the cheap
// setup detectors, and promotes the strongest setup per symbol into a
// structured TradeIdea (with a synthesized ATM contract sized to the timeframe)
// for the decision engine to score. SPY/QQQ are always scanned.

import type { MarketDataProvider } from '../data/provider.js';
import type { TradeIdea, OptionType } from '../lib/types.js';
import { analyzeMtf, type MtfResult } from './mtf.js';
import { fullUniverse, tierOf } from './universe.js';
import { selectStrike, dteFor, expiryForDte, estPremium } from './contracts.js';
import { last, pctChange } from './indicators.js';

export class Scanner {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly universe: string[] = fullUniverse(),
  ) {}

  /** One scan pass → one (best) multi-timeframe candidate per symbol. `vix` (from
   *  the live market context) drives VIX-adaptive strike/DTE/premium selection. */
  async scanOnce(strengthFloor = 0.5, vix?: number): Promise<TradeIdea[]> {
    const refReturn = await this.spyReturn();
    const ideas: TradeIdea[] = [];

    for (const symbol of this.universe) {
      const m = await analyzeMtf(this.provider, symbol, refReturn);
      if (!m || m.primary.strength < strengthFloor) continue;
      ideas.push(toIdea(symbol, m, vix));
    }
    return ideas;
  }

  private async spyReturn(): Promise<number> {
    const bars = await this.provider.getBars('SPY', '1Min', 30);
    if (bars.length < 2) return 0;
    return pctChange(bars[0]!.c, last(bars)!.c);
  }
}

function toIdea(symbol: string, m: MtfResult, vix?: number): TradeIdea {
  const sig = m.primary;
  const optionType: OptionType = sig.direction === 'long' ? 'call' : 'put';
  const horizon = m.horizon;
  return {
    alertId: `scan-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticker: symbol,
    direction: sig.direction,
    setup: sig.setup,
    timeframe: horizon,
    tier: tierOf(symbol),
    contract: {
      ticker: symbol,
      optionType,
      strike: selectStrike(symbol, m.price, optionType, horizon, vix),
      expiry: expiryForDte(dteFor(horizon, vix)),
      dte: dteFor(horizon, vix),
    },
    entry: round(sig.entry),
    stop: round(sig.stop),
    targets: sig.targets,
    premium: estPremium(symbol, m.price, horizon, vix),
    notes: sig.rationale,
    mtf: { timeframes: m.timeframes, agreement: m.agreement, conflict: m.conflict },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
