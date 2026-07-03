// The active scanner. Pulls real-time bars for the universe, runs the cheap
// setup detectors, and promotes the strongest setup per symbol into a
// structured TradeIdea (with a synthesized ATM contract sized to the timeframe)
// for the decision engine to score. SPY/QQQ are always scanned.

import type { MarketDataProvider } from '../data/provider.js';
import type { TradeIdea, OptionType, TrendSnapshot, KeyLevels, VolumeStats, Timeframe } from '../lib/types.js';
import type { ChainSnapshot } from '../options/provider.js';
import { analyzeMtf, type MtfResult } from './mtf.js';
import { fullUniverse, tierOf } from './universe.js';
import { dteFor } from './contracts.js';
import { selectRealContract, snapExpiry, type SelectedContract } from './contractSelect.js';
import { last, pctChange } from './indicators.js';
import { computeTrendSnapshot } from '../context/trend.js';
import { computeKeyLevels, snapTargets } from './levels.js';
import { computeVolumeStats } from './volume.js';
import { getChainSnapshot } from '../options/index.js';

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
      const intel = await this.intelFor(symbol, m.price);
      const sel = await this.pickContract(symbol, m.primary.direction === 'long' ? 'call' : 'put', m.horizon, m.price, vix, intel.chain);
      ideas.push(toIdea(symbol, m, sel, intel));
    }
    return ideas;
  }

  /** Intelligence layer for a candidate: higher-TF trend stack, level map (walls),
   *  and relative volume. All best-effort — a feed hiccup degrades to undefined
   *  rather than killing the scan. Bars are shared with analyzeMtf via the cache. */
  async intelFor(symbol: string, price: number): Promise<TickerScanIntel> {
    const [trend, chain, rvol, fifteens, daily] = await Promise.all([
      computeTrendSnapshot(this.provider, symbol).catch(() => undefined),
      getChainSnapshot(symbol),
      computeVolumeStats(this.provider, symbol).catch(() => undefined),
      this.provider.getBars(symbol, '15Min', 60).catch(() => []),
      this.provider.getBars(symbol, '1Day', 30).catch(() => []),
    ]);
    const levels = fifteens.length || daily.length || chain
      ? computeKeyLevels({ ticker: symbol, price, intraday: fifteens, daily, chain })
      : undefined;
    return { trend, levels, rvol, chain };
  }

  /** Contract for the idea: snap DTE to a real listed expiry, fetch that expiry's
   *  quotes if the front chain isn't it, then chain-anchor (or model-fallback). */
  private async pickContract(
    symbol: string,
    optionType: OptionType,
    horizon: Timeframe,
    price: number,
    vix: number | undefined,
    front: ChainSnapshot | null,
  ): Promise<SelectedContract> {
    let chain = front;
    if (front && this.provider.realtime) {
      const snapped = snapExpiry(dteFor(horizon, vix), front.expirations);
      if (snapped && snapped.expiry !== front.expiry) {
        chain = (await getChainSnapshot(symbol, snapped.expiry)) ?? front;
      }
    }
    return selectRealContract({
      ticker: symbol, price, optionType, horizon, vix, chain,
      realtimeData: this.provider.realtime,
    });
  }

  private async spyReturn(): Promise<number> {
    const bars = await this.provider.getBars('SPY', '1Min', 30);
    if (bars.length < 2) return 0;
    return pctChange(bars[0]!.c, last(bars)!.c);
  }
}

export interface TickerScanIntel {
  trend?: TrendSnapshot;
  levels?: KeyLevels;
  rvol?: VolumeStats;
  chain: ChainSnapshot | null;
}

function toIdea(symbol: string, m: MtfResult, sel: SelectedContract, intel: TickerScanIntel): TradeIdea {
  const sig = m.primary;
  const horizon = m.horizon;
  // Snap targets to the walls — take profit in FRONT of resistance, not through it.
  const targets = intel.levels
    ? snapTargets(sig.entry, sig.targets, sig.direction, intel.levels)
    : sig.targets;
  return {
    alertId: `scan-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticker: symbol,
    direction: sig.direction,
    setup: sig.setup,
    timeframe: horizon,
    tier: tierOf(symbol),
    contract: sel.contract,
    entry: round(sig.entry),
    stop: round(sig.stop),
    targets,
    premium: sel.premium,
    notes: `${sig.rationale} · ${sel.note}`,
    mtf: { timeframes: m.timeframes, agreement: m.agreement, conflict: m.conflict },
    trend: intel.trend,
    levels: intel.levels,
    rvol: intel.rvol,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
