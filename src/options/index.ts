// Options-flow provider factory. Degraded mode by design: the only free source of
// options data is a ~15-minute-DELAYED chain (Yahoo Finance). We derive unusual
// vol/OI strikes, a put/call volume ratio, rough gamma magnets (OI clusters) and a
// net-flow bias FROM that chain — and never invent sweeps/blocks we cannot see.
//
// Yahoo endpoint (no key, rate-limited): query1.finance.yahoo.com/v7/finance/options/TICKER
// It can 401/rate-limit without a cookie/crumb; on ANY failure we return null so the
// caller degrades gracefully (scoreOptionsChain stays neutral rather than guessing).

import type { ChainSnapshot, OptionsChainProvider, UnusualStrike, StrikeQuote } from './provider.js';
import { isClockFrozen } from '../lib/clock.js';

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
  quote?: { regularMarketTime?: number; regularMarketPrice?: number };
  expirationDates?: number[]; // epoch seconds (UTC midnight) of every listed expiry
  options?: YahooOptionMap[];
}
interface YahooResponse {
  optionChain?: { result?: YahooResult[]; error?: unknown };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const epochToDate = (sec: number): string => new Date(sec * 1000).toISOString().slice(0, 10);
const dateToEpoch = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

/** Real listed quotes for the ~10 strikes per side nearest spot. The market for
 *  the actual contracts — bid/ask/IV/OI/volume the model layer can anchor to. */
function nearSpotQuotes(calls: YahooOptionRow[], puts: YahooOptionRow[], spot: number | null): StrikeQuote[] {
  const toQuote = (r: YahooOptionRow, type: 'call' | 'put'): StrikeQuote | null => {
    if (r.strike == null) return null;
    const bid = r.bid ?? null;
    const ask = r.ask ?? null;
    const mid = bid != null && ask != null && ask > 0 ? round2((bid + ask) / 2) : null;
    return {
      strike: r.strike, type, bid, ask, mid,
      iv: r.impliedVolatility != null ? Math.round(r.impliedVolatility * 1000) / 1000 : null,
      openInterest: r.openInterest ?? 0,
      volume: r.volume ?? 0,
      spreadPct: mid != null && mid > 0 && bid != null && ask != null ? round2(((ask - bid) / mid) * 100) : null,
    };
  };
  const pick = (rows: YahooOptionRow[], type: 'call' | 'put'): StrikeQuote[] => {
    const qs = rows.map((r) => toQuote(r, type)).filter((q): q is StrikeQuote => q != null);
    if (spot == null) return qs.slice(0, 20);
    return qs.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, 20)
      .sort((a, b) => a.strike - b.strike);
  };
  return [...pick(calls, 'call'), ...pick(puts, 'put')];
}

/** Build a snapshot from one expiry's calls/puts. Pure — no I/O. */
function buildSnapshot(
  ticker: string,
  calls: YahooOptionRow[],
  puts: YahooOptionRow[],
  marketTimeSec: number | undefined,
  spot: number | null,
  expirations: string[],
  expiry: string | null,
): ChainSnapshot {
  const unusualStrikes: UnusualStrike[] = [];
  const volByStrike = new Map<number, number>(); // strike -> total volume (calls+puts)
  const oiByStrike = new Map<number, number>(); // strike -> total open interest (gamma proxy)
  const callOiByStrike = new Map<number, number>(); // strike -> call OI (call wall)
  const putOiByStrike = new Map<number, number>(); // strike -> put OI (put wall)
  let callVol = 0;
  let putVol = 0;

  const scan = (rows: YahooOptionRow[], type: 'call' | 'put'): void => {
    for (const r of rows) {
      const strike = r.strike;
      if (strike == null) continue;
      const volume = r.volume ?? 0;
      const oi = r.openInterest ?? 0;
      if (type === 'call') { callVol += volume; callOiByStrike.set(strike, (callOiByStrike.get(strike) ?? 0) + oi); }
      else { putVol += volume; putOiByStrike.set(strike, (putOiByStrike.get(strike) ?? 0) + oi); }
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

  // Call/put walls — the single biggest OI strike per side. Dealer hedging makes
  // these act as magnets/lids: price grinds toward them and struggles through.
  const maxOiStrike = (m: Map<number, number>): number | null => {
    let best: number | null = null;
    let bestOi = 0;
    for (const [strike, oi] of m) if (oi > bestOi) { bestOi = oi; best = strike; }
    return best;
  };
  const callWall = maxOiStrike(callOiByStrike);
  const putWall = maxOiStrike(putOiByStrike);

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
    spot: spot != null ? round2(spot) : null,
    expiry,
    expirations,
    quotes: nearSpotQuotes(calls, puts, spot),
    unusualStrikes: unusualStrikes.slice(0, 12),
    highestVolumeStrikes,
    putCallVolRatio,
    gammaMagnets,
    callWall,
    putWall,
    netFlowBias,
    note: HONEST_NOTE,
  };
}

/** Free, ~15-minute-delayed chain from Yahoo Finance. No key. Never throws.
 *  Pass `expiry` (YYYY-MM-DD, from snapshot.expirations) to quote a specific
 *  listed expiration instead of the front one. */
class YahooDelayedOptions implements OptionsChainProvider {
  readonly name = 'yahoo-options-delayed';

  async snapshot(ticker: string, expiry?: string): Promise<ChainSnapshot | null> {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return null;
    try {
      const date = expiry ? `?date=${dateToEpoch(expiry)}` : '';
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}${date}`;
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
      const expirations = (result.expirationDates ?? []).map(epochToDate);
      const quoted = nearest.expirationDate != null ? epochToDate(nearest.expirationDate) : expiry ?? expirations[0] ?? null;
      return buildSnapshot(
        result.underlyingSymbol ?? sym, calls, puts,
        result.quote?.regularMarketTime, result.quote?.regularMarketPrice ?? null,
        expirations, quoted,
      );
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

// Per-tick snapshot cache — the scanner (levels/walls), the chain lens, and the
// contract selector all want the same chain within one pass; Yahoo rate-limits,
// so fetch each (ticker, expiry) once.
const SNAP_TTL_MS = 90_000;
const snapCache = new Map<string, { at: number; snap: ChainSnapshot | null }>();

/** Cached delayed-chain snapshot (front expiry by default; pass a listed expiry
 *  to quote that one). Same never-throws contract as the provider. */
export async function getChainSnapshot(ticker: string, expiry?: string): Promise<ChainSnapshot | null> {
  // Replay: there is no historical delayed chain — fetching would return TODAY's
  // for a past bar. Return null so contracts fall back to the model (correct + fast).
  if (isClockFrozen()) return null;
  const key = `${ticker.trim().toUpperCase()}:${expiry ?? 'front'}`;
  const hit = snapCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < SNAP_TTL_MS) return hit.snap;
  const snap = await makeOptionsProvider().snapshot(ticker.trim().toUpperCase(), expiry).catch(() => null);
  // Don't cache a null from a transient failure for the full TTL — retry sooner.
  snapCache.set(key, { at: snap ? now : now - SNAP_TTL_MS + 15_000, snap });
  return snap;
}

export type { ChainSnapshot, OptionsChainProvider, UnusualStrike, StrikeQuote } from './provider.js';
