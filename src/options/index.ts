// Options-flow provider factory. Degraded mode by design: the only free source of
// options data is a ~15-minute-DELAYED chain (Yahoo Finance). We derive unusual
// vol/OI strikes, a put/call volume ratio, rough gamma magnets (OI clusters) and a
// net-flow bias FROM that chain — and never invent sweeps/blocks we cannot see.
//
// Yahoo endpoint (no key, rate-limited): query1.finance.yahoo.com/v7/finance/options/TICKER
// It can 401/rate-limit without a cookie/crumb; on ANY failure we return null so the
// caller degrades gracefully (scoreOptionsChain stays neutral rather than guessing).

import type { ChainSnapshot, OptionsChainProvider, UnusualStrike } from './provider.js';

const HONEST_NOTE =
  'FREE/DELAYED ~15m — no real-time sweep/block tape; derived from the delayed chain (volume/OI), not order flow.';

// ---- Yahoo delayed-chain shapes (only the fields we read) -----------------
interface YahooOptionRow {
  strike?: number;
  volume?: number;
  openInterest?: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
}
interface YahooOptionMap {
  expirationDate?: number;
  calls?: YahooOptionRow[];
  puts?: YahooOptionRow[];
}
interface YahooResult {
  underlyingSymbol?: string;
  quote?: { regularMarketTime?: number };
  options?: YahooOptionMap[];
}
interface YahooResponse {
  optionChain?: { result?: YahooResult[]; error?: unknown };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Build a snapshot from the nearest-expiry calls/puts. Pure — no I/O. */
function buildSnapshot(
  ticker: string,
  calls: YahooOptionRow[],
  puts: YahooOptionRow[],
  marketTimeSec: number | undefined,
): ChainSnapshot {
  const unusualStrikes: UnusualStrike[] = [];
  const volByStrike = new Map<number, number>(); // strike -> total volume (calls+puts)
  const oiByStrike = new Map<number, number>(); // strike -> total open interest (gamma proxy)
  let callVol = 0;
  let putVol = 0;

  const scan = (rows: YahooOptionRow[], type: 'call' | 'put'): void => {
    for (const r of rows) {
      const strike = r.strike;
      if (strike == null) continue;
      const volume = r.volume ?? 0;
      const oi = r.openInterest ?? 0;
      if (type === 'call') callVol += volume;
      else putVol += volume;
      volByStrike.set(strike, (volByStrike.get(strike) ?? 0) + volume);
      oiByStrike.set(strike, (oiByStrike.get(strike) ?? 0) + oi);
      // Unusual = today's volume ran hot vs resting OI. Guard OI>0 (no divide-by-0)
      // and require real volume so we don't flag illiquid noise.
      if (oi > 0 && volume > 0) {
        const ratio = volume / oi;
        if (ratio > 2) {
          unusualStrikes.push({ strike, type, volume, openInterest: oi, volOiRatio: round2(ratio) });
        }
      }
    }
  };
  scan(calls, 'call');
  scan(puts, 'put');

  unusualStrikes.sort((a, b) => b.volOiRatio - a.volOiRatio);

  const highestVolumeStrikes = [...volByStrike.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([strike]) => strike);

  // Rough gamma magnets: the biggest open-interest clusters — the strikes dealer
  // hedging tends to pin price toward. Returned low-to-high for readability.
  const gammaMagnets = [...oiByStrike.entries()]
    .filter(([, oi]) => oi > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([strike]) => strike)
    .sort((a, b) => a - b);

  const totalVol = callVol + putVol;
  const putCallVolRatio = callVol > 0 ? round2(putVol / callVol) : null;

  let netFlowBias: 'bullish' | 'bearish' | 'mixed' = 'mixed';
  if (totalVol > 0) {
    const callShare = callVol / totalVol;
    if (callShare >= 0.6) netFlowBias = 'bullish';
    else if (callShare <= 0.4) netFlowBias = 'bearish';
  }

  const asOf =
    marketTimeSec != null && Number.isFinite(marketTimeSec)
      ? new Date(marketTimeSec * 1000).toISOString()
      : new Date().toISOString();

  return {
    ticker,
    delayed: true,
    asOf,
    unusualStrikes: unusualStrikes.slice(0, 12),
    highestVolumeStrikes,
    putCallVolRatio,
    gammaMagnets,
    netFlowBias,
    note: HONEST_NOTE,
  };
}

/** Free, ~15-minute-delayed chain from Yahoo Finance. No key. Never throws. */
class YahooDelayedOptions implements OptionsChainProvider {
  readonly name = 'yahoo-options-delayed';

  async snapshot(ticker: string): Promise<ChainSnapshot | null> {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return null;
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as YahooResponse;
      const result = data.optionChain?.result?.[0];
      if (!result) return null;
      const nearest = result.options?.[0];
      if (!nearest) return null;
      const calls = nearest.calls ?? [];
      const puts = nearest.puts ?? [];
      if (calls.length === 0 && puts.length === 0) return null;
      return buildSnapshot(result.underlyingSymbol ?? sym, calls, puts, result.quote?.regularMarketTime);
    } catch {
      // Rate-limited, offline, cookie/crumb wall, bad JSON — degrade silently.
      return null;
    }
  }
}

/** Fallback provider — always returns null (used when the free feed is disabled). */
export class StubOptions implements OptionsChainProvider {
  readonly name = 'none';
  async snapshot(): Promise<ChainSnapshot | null> {
    return null;
  }
}

/** The active options-flow provider. Yahoo needs no key, so it's always tried;
 *  set OPTIONS_FLOW_DISABLED=true to force the null Stub (e.g. for offline runs). */
export function makeOptionsProvider(): OptionsChainProvider {
  if ((process.env.OPTIONS_FLOW_DISABLED || '').toLowerCase() === 'true') {
    return new StubOptions();
  }
  return new YahooDelayedOptions();
}

export function optionsProviderName(): string {
  return makeOptionsProvider().name;
}

export type { ChainSnapshot, OptionsChainProvider, UnusualStrike } from './provider.js';
