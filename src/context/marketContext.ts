// Live daily market-context brain. Computes TODAY's real regime from market
// data on every scan, so the bot is "in accord with current markets" instead of
// running on sample values. Regime/breadth/vol come straight from the data
// provider (no extra API); Fear & Greed is a best-effort free fetch with a
// derived fallback. Event/earnings calendars are the next integration (Finnhub).

import type { MarketContext } from '../lib/types.js';
import type { MarketDataProvider } from '../data/provider.js';
import { sma, pctChange } from '../scan/indicators.js';
import { getVerifiedHeadlines } from '../news/index.js';
import { makeCalendarProvider, hasHighImpactToday } from '../calendar/index.js';

type Trend = 'up' | 'down' | 'flat';
const round2 = (n: number) => Math.round(n * 100) / 100;

async function trendOf(provider: MarketDataProvider, symbol: string): Promise<Trend> {
  const bars = await provider.getBars(symbol, '1Day', 30);
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const ma = sma(closes, 20);
  if (price == null || ma == null) return 'flat';
  const ref = closes[Math.max(0, closes.length - 6)] ?? price; // ~1 week ago
  const slope = pctChange(ref, price);
  if (price > ma && slope > 0.3) return 'up';
  if (price < ma && slope < -0.3) return 'down';
  return 'flat';
}

/** Annualized realized-vol proxy for VIX from SPY daily returns (real VIX feed = later). */
async function vixProxy(provider: MarketDataProvider): Promise<number> {
  const bars = await provider.getBars('SPY', '1Day', 21);
  const c = bars.map((b) => b.c);
  if (c.length < 5) return 18;
  const rets: number[] = [];
  for (let i = 1; i < c.length; i++) rets.push((c[i]! - c[i - 1]!) / c[i - 1]!);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  const annualized = Math.sqrt(variance) * Math.sqrt(252) * 100;
  return round2(Math.max(8, Math.min(80, annualized)));
}

/** CNN Fear & Greed (best-effort free endpoint); falls back to a regime-derived value. */
async function fearGreed(breadth: number, spy: Trend): Promise<number> {
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as { fear_and_greed?: { score?: number } };
      const score = data.fear_and_greed?.score;
      if (typeof score === 'number') return Math.round(score);
    }
  } catch {
    // fall through to derived value
  }
  const base = 50 + breadth * 25 + (spy === 'up' ? 10 : spy === 'down' ? -10 : 0);
  return Math.max(0, Math.min(100, Math.round(base)));
}

export interface ContextOpts {
  /** Tickers with earnings today/tomorrow (per-ticker; calendar feed later). */
  earningsSoon?: Set<string>;
}

/**
 * Build today's market context from live data. `universe` is used for breadth.
 * Returns a market-wide context; set per-ticker `earningsSoon` at the call site.
 */
export async function buildMarketContext(
  provider: MarketDataProvider,
  universe: string[],
): Promise<MarketContext> {
  const [spyTrend, qqqTrend, vix] = await Promise.all([
    trendOf(provider, 'SPY'),
    trendOf(provider, 'QQQ'),
    vixProxy(provider),
  ]);

  // Breadth: share of the universe trading above its 20-day average (-1..1).
  let adv = 0, tot = 0;
  for (const sym of universe) {
    const bars = await provider.getBars(sym, '1Day', 30);
    const c = bars.map((b) => b.c);
    const ma = sma(c, 20);
    const p = c[c.length - 1];
    if (ma != null && p != null) { tot++; if (p >= ma) adv++; }
  }
  const breadth = tot ? round2((adv / tot) * 2 - 1) : 0;

  const todayKey = new Date().toISOString().slice(0, 10);
  const [news, macro] = await Promise.all([
    getVerifiedHeadlines(['SPY', 'QQQ'], 6),
    makeCalendarProvider().macroEvents(), // free econ calendar; [] without a key
  ]);

  return {
    asOf: new Date().toISOString(),
    spyTrend,
    qqqTrend,
    vix,
    vixTrend: vix > 22 ? 'up' : vix < 14 ? 'down' : 'flat',
    breadth,
    fearGreed: await fearGreed(breadth, spyTrend),
    // Real, attributed headlines (verified source) — empty if no news feed configured.
    headlines: news.map((n) => `${n.headline} — ${n.source}`),
    eventRiskToday: hasHighImpactToday(macro, todayKey),
    earningsSoon: false, // set per-ticker by the caller (calendar.earningsFor)
  };
}
