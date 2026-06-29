// The scan universe. The INDEX ETFs are PRIORITY — the franchise — always
// scanned first every pass and handled by the index-specialist logic (clean
// level respect, SPY↔QQQ cross-confirmation). The rest is a curated liquid,
// optionable list (mag7 + the semis complex that leads them). "Scan everything"
// in practice = this liquid set — free-tier data rate limits make literally-all
// tickers impractical; extend either list as needed.

// SPY/QQQ are the specialty; IWM (Russell 2000) + DIA (Dow) round out the indices.
export const PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA'] as const;

// SMH = semis ETF (leads NVDA/AMD/MU); AVGO added to the semis complex.
export const SCAN_UNIVERSE = [
  'SMH', 'MU', 'NVDA', 'AMD', 'AVGO', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'NFLX',
] as const;

// Index ETFs get the specialist treatment (level-based setups weighted up).
const INDEX_ETFS = new Set<string>(['SPY', 'QQQ', 'IWM', 'DIA', 'SMH']);
export const isIndex = (symbol: string): boolean => INDEX_ETFS.has(symbol);

export function fullUniverse(): string[] {
  return [...PRIORITY, ...SCAN_UNIVERSE];
}
