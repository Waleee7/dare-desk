// The active scanner. Pulls real-time bars for the universe, runs the cheap
// setup detectors, and promotes the strongest setup per symbol into a
// structured TradeIdea (with a synthesized ATM contract sized to the timeframe)
// for the decision engine to score. SPY/QQQ are always scanned.

import type { MarketDataProvider } from '../data/provider.js';
import type { TradeIdea, OptionType } from '../lib/types.js';
import { analyzeMtf, type MtfResult } from './mtf.js';
import { fullUniverse } from './universe.js';
import { selectStrike, dteFor, expiryForDte, estPremium } from './contracts.js';
import { last, pctChange } from './indicators.js';

export class Scanner {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly universe: string[] = fullUniverse(),
  ) {}

  /** One scan pass → one (best) multi-timeframe candidate per symbol. */
  async scanOnce(strengthFloor = 0.5): Promise<TradeIdea[]> {
    const refReturn = await this.spyReturn();
    const ideas: TradeIdea[] = [];

    for (const symbol of this.universe) {
      const m = await analyzeMtf(this.provider, symbol, refReturn);
      if (!m || m.primary.strength < strengthFloor) continue;
      ideas.push(toIdea(symbol, m));
    }
    return ideas;
  }

  private async spyReturn(): Promise<number> {
    const bars = await this.provider.getBars('SPY', '1Min', 30);
    if (bars.length < 2) return 0;
    return pctChange(bars[0]!.c, last(bars)!.c);
  }
}

function toIdea(symbol: string, m: MtfResult): TradeIdea {
  const sig = m.primary;
  const optionType: OptionType = sig.direction === 'long' ? 'call' : 'put';
  return {
    alertId: `scan-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticker: symbol,
    direction: sig.direction,
    setup: sig.setup,
    timeframe: m.horizon,
    contract: {
      ticker: symbol,
      optionType,
      strike: selectStrike(symbol, m.price, optionType, m.horizon),
      expiry: expiryForDte(dteFor(m.horizon)),
      dte: dteFor(m.horizon),
    },
    entry: round(sig.entry),
    stop: round(sig.stop),
    targets: sig.targets,
    premium: estPremium(symbol, m.price, m.horizon),
    notes: sig.rationale,
    mtf: { timeframes: m.timeframes, agreement: m.agreement, conflict: m.conflict },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
