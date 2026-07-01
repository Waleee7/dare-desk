// The scan universe. The INDEX ETFs are PRIORITY — the franchise — always
// scanned first every pass and handled by the index-specialist logic (clean
// level respect, SPY↔QQQ cross-confirmation). The rest is a curated liquid,
// optionable list (mag7 + the semis complex that leads them). "Scan everything"
// in practice = this liquid set — free-tier data rate limits make literally-all
// tickers impractical; extend either list as needed.

import type { Tier } from '../lib/types.js';

// SPY/QQQ are the specialty; IWM (Russell 2000) + DIA (Dow) round out the indices.
export const PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA'] as const;

// SMH = semis ETF (leads NVDA/AMD/MU); AVGO added to the semis complex.
export const SCAN_UNIVERSE = [
  'SMH', 'MU', 'NVDA', 'AMD', 'AVGO', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'NFLX',
] as const;

// Index ETFs get the specialist treatment (level-based setups weighted up).
const INDEX_ETFS = new Set<string>(['SPY', 'QQQ', 'IWM', 'DIA', 'SMH']);
export const isIndex = (symbol: string): boolean => INDEX_ETFS.has(symbol);

// Momentum/gamma names — high-IV movers Josh actually scalps 0DTE (TSLA his bread
// and butter). These get the 0DTE momentum-continuation detector + a strength bump
// so a clean rip gets promoted aggressively, and they scan first each pass.
const MOMENTUM = new Set<string>(['TSLA', 'NVDA', 'AMD', 'META', 'MU', 'AVGO', 'SMH', 'NFLX']);
export const isMomentum = (symbol: string): boolean => MOMENTUM.has(symbol);

// Indices first (the franchise), then momentum movers, then the rest.
export function fullUniverse(): string[] {
  const rest = SCAN_UNIVERSE.filter((s) => !isMomentum(s));
  const movers = SCAN_UNIVERSE.filter((s) => isMomentum(s));
  return [...PRIORITY, ...movers, ...rest];
}

// --- Universe tiers (sets the alert bar) ---------------------------------------
// Core = QQQ/SPY (the edge). Focus = Mag7 + semis complex. Extended = anything
// else — allowed to fire ONLY at A+ (>=90). tierOf resolves deterministically:
// Core first, then Focus, else Extended.
export const CORE = new Set<string>(['SPY', 'QQQ']);
const MAG7 = new Set<string>(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']);
const SEMIS = new Set<string>(['AMD', 'AVGO', 'MU', 'SMH', 'SOXL', 'TSM', 'NVDA']);
export const FOCUS = new Set<string>([...MAG7, ...SEMIS]);

/** Universe tier for a symbol — Core/Focus fire at A, Extended needs A+ (>=90). */
export function tierOf(symbol: string): Tier {
  const s = symbol.toUpperCase();
  if (CORE.has(s)) return 'core';
  if (FOCUS.has(s)) return 'focus';
  return 'extended';
}
