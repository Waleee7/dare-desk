// Real contract selection — the bridge from "modeled idea" to "listed contract."
// The delayed Yahoo chain gives us every listed expiry and real bid/ask/IV/OI/vol
// near the money; this module snaps the model's strike/DTE ladder onto contracts
// that actually EXIST and are actually TRADEABLE (liquidity + spread filters),
// and anchors the premium to the real (delay-corrected) mid instead of a factor
// table. Falls back to the pure model when the chain is unavailable or the
// underlying feed is mock (never mix real chain mids with fake prices).

import type { Contract, OptionType, Timeframe } from '../lib/types.js';
import type { ChainSnapshot, StrikeQuote } from '../options/provider.js';
import { selectStrike, dteFor, expiryForDte, estPremium, estDelta } from './contracts.js';
import { config } from '../lib/config.js';
import { nowEt } from '../lib/clock.js';

export interface SelectedContract {
  contract: Contract;
  premium: number; // per-share — delay-corrected real mid, or the model estimate
  source: 'chain' | 'model';
  note: string;
}

const tidy = (n: number) => Math.round(n * 100) / 100;

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Calendar days from TODAY (ET) to a YYYY-MM-DD expiry. */
export function dteTo(expiry: string, now: Date = new Date()): number {
  const today = Date.parse(`${ymd(nowEt(now))}T00:00:00Z`);
  const exp = Date.parse(`${expiry}T00:00:00Z`);
  return Math.round((exp - today) / 86_400_000);
}

/** Snap a target DTE to the nearest LISTED expiry (never a date that doesn't
 *  trade). Prefers the closest match; past expiries are excluded. */
export function snapExpiry(
  targetDte: number,
  expirations: string[],
  now: Date = new Date(),
): { expiry: string; dte: number } | null {
  const listed = expirations
    .map((e) => ({ expiry: e, dte: dteTo(e, now) }))
    .filter((e) => e.dte >= 0)
    .sort((a, b) => Math.abs(a.dte - targetDte) - Math.abs(b.dte - targetDte) || a.dte - b.dte);
  return listed[0] ?? null;
}

/** Liquidity screen: is this listed strike actually tradeable? */
export function isTradeable(q: StrikeQuote): boolean {
  if (q.mid == null || q.mid < 0.05) return false;
  if (q.spreadPct != null && q.spreadPct > config.risk.maxSpreadPct) return false;
  return q.openInterest >= 250 || q.volume >= 100;
}

export interface SelectInput {
  ticker: string;
  price: number; // LIVE underlying
  optionType: OptionType;
  horizon: Timeframe;
  vix?: number;
  /** Chain for the TRADED expiry (caller snaps expiry first), or null. */
  chain: ChainSnapshot | null;
  /** Is the underlying feed real? Mock prices must never meet real chain mids. */
  realtimeData: boolean;
  now?: Date;
}

/** Pick the contract. Chain-anchored when possible; honest model otherwise. */
export function selectRealContract(inp: SelectInput): SelectedContract {
  const { ticker, price, optionType, horizon, vix, chain, realtimeData, now = new Date() } = inp;
  const modelStrike = selectStrike(ticker, price, optionType, horizon, vix);
  const modelDte = dteFor(horizon, vix);

  const fallback = (note: string): SelectedContract => ({
    contract: {
      ticker, optionType, strike: modelStrike,
      expiry: expiryForDte(modelDte), dte: modelDte,
    },
    premium: estPremium(ticker, price, horizon, vix),
    source: 'model',
    note,
  });

  if (!chain || !realtimeData) {
    return fallback(!chain ? 'no chain feed — modeled contract' : 'mock data feed — modeled contract');
  }

  const snapped = snapExpiry(modelDte, chain.expirations, now);
  if (!snapped) return fallback('no listed expirations — modeled contract');

  // Quotes must belong to the traded expiry; a mismatched snapshot degrades to model.
  if (chain.expiry !== snapped.expiry) return fallback(`no quotes for ${snapped.expiry} — modeled contract`);

  const sameType = chain.quotes.filter((q) => q.type === optionType && q.mid != null && q.mid > 0);
  if (!sameType.length) return fallback('empty chain quotes — modeled contract');

  const byDistance = [...sameType].sort(
    (a, b) => Math.abs(a.strike - modelStrike) - Math.abs(b.strike - modelStrike),
  );
  const pick = byDistance.find(isTradeable) ?? byDistance[0]!;
  const stepped = pick.strike !== byDistance[0]!.strike;

  // Delay correction: the chain is ~15m old — move the mid by delta × the gap
  // between the live underlying and the chain's spot (bounded to ±50% of mid).
  const delta = estDelta(horizon);
  const dir = optionType === 'call' ? 1 : -1;
  const drift = chain.spot != null ? dir * delta * (price - chain.spot) : 0;
  const bounded = Math.max(-pick.mid! * 0.5, Math.min(pick.mid! * 0.5, drift));
  const premium = Math.max(0.05, tidy(pick.mid! + bounded));

  return {
    contract: {
      ticker, optionType, strike: pick.strike,
      expiry: snapped.expiry, dte: snapped.dte,
      bid: pick.bid ?? undefined, ask: pick.ask ?? undefined,
      iv: pick.iv ?? undefined,
      openInterest: pick.openInterest, volume: pick.volume,
    },
    premium,
    source: 'chain',
    note: `chain-anchored (delayed mid ${pick.mid}${chain.spot != null ? `, spot drift ${tidy(price - chain.spot)}` : ''})`
      + `${stepped ? ' · stepped to nearest liquid strike' : ''}${!isTradeable(pick) ? ' · ILLIQUID — no strike passed filters' : ''}`,
  };
}
