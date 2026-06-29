// The active scanner. Pulls real-time bars for the universe, runs the cheap
// setup detectors, and promotes the strongest setup per symbol into a
// structured TradeIdea (with a synthesized ATM contract sized to the timeframe)
// for the decision engine to score. SPY/QQQ are always scanned.

import type { MarketDataProvider } from '../data/provider.js';
import type { TradeIdea, OptionType, Timeframe } from '../lib/types.js';
import { analyzeMtf, type MtfResult } from './mtf.js';
import { fullUniverse } from './universe.js';
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
      strike: atmStrike(m.price),
      expiry: nearestExpiry(m.horizon),
    },
    entry: round(sig.entry),
    stop: round(sig.stop),
    targets: sig.targets,
    premium: estPremium(m.price, m.horizon),
    notes: sig.rationale,
    mtf: { timeframes: m.timeframes, agreement: m.agreement, conflict: m.conflict },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const atmStrike = (price: number) => Math.round(price); // $1 increments for liquid names

function estPremium(price: number, tf: Timeframe): number {
  // Plausible ATM premium until a real options chain is wired (Phase 2).
  const factor = tf === 'scalp' ? 0.004 : tf === 'intraday' ? 0.009 : 0.025;
  return round(price * factor);
}

function nearestExpiry(tf: Timeframe): string {
  const d = new Date();
  if (tf === 'scalp') return iso(d); // 0DTE
  if (tf === 'intraday') return iso(nextFriday(d));
  const swing = new Date(d);
  swing.setDate(swing.getDate() + 21);
  return iso(swing);
}

function nextFriday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const add = (5 - day + 7) % 7 || 7; // next Friday (at least 1 day out)
  d.setDate(d.getDate() + add);
  return d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
