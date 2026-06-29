// Component 8 — Backtest & Shadow mode (scaffold). Proves edge before risking
// money. Phase 3 fills the historical data layer; the contracts here lock in
// the anti-cheating rules so the implementation can't drift.

export type RunMode =
  | 'backtest'   // historical signals
  | 'replay'     // simulate a market day tick-by-tick
  | 'shadow'     // alert without trading
  | 'paper'      // simulated execution
  | 'approval'   // human confirms each
  | 'live';      // disabled until explicitly enabled

export interface BacktestAssumptions {
  bidAskSpreadPct: number; // model realistic spread cost
  slippagePct: number; // model fill slippage
  commissionPerContract: number;
}

export const DEFAULT_ASSUMPTIONS: BacktestAssumptions = {
  bidAskSpreadPct: 5,
  slippagePct: 1.5,
  commissionPerContract: 0.65,
};

export interface PerformanceMetrics {
  trades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
  lateEntryRate: number;
  falsePositiveRate: number;
  missedOpportunityRate: number;
  sampleSizeAdequate: boolean; // require >= 100 trades before any claim
}

/**
 * Anti-cheating contract for any backtest implementation:
 *  - no lookahead: never read a candle the live bot wouldn't have had
 *  - include spread + slippage + commission on every fill
 *  - separate train/test periods; walk-forward validate
 *  - report sample size; refuse "profitable" claims under ~100 trades
 */
export interface BacktestRunner {
  mode: RunMode;
  assumptions: BacktestAssumptions;
  run(): Promise<PerformanceMetrics>;
}

export function claimsAllowed(m: PerformanceMetrics): boolean {
  return m.sampleSizeAdequate && m.trades >= 100;
}
