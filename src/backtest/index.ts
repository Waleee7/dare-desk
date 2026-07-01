// Component 8 — Backtest, realistic fills & expectancy. Models honest fills (spread +
// slippage + commission) and computes R-multiple expectancy over closed paper trades —
// the evidence behind the prove-it gate. All fills are MODELED (no live chain).

import { config } from '../lib/config.js';
import type { ClosedTrade, ExpectancyStats } from '../lib/types.js';

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

// Single source of fill assumptions = config.fills (env-overridable). MODELED.
export const DEFAULT_ASSUMPTIONS: BacktestAssumptions = {
  bidAskSpreadPct: config.fills.bidAskSpreadPct,
  slippagePct: config.fills.slippagePct,
  commissionPerContract: config.fills.commissionPerContract,
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

// --- Realistic (modeled) fills ---------------------------------------------------
export interface RealisticFill {
  fillPremium: number; // per-share premium actually (modeled) paid — worse than mid
  costPerContractUsd: number; // fillPremium * 100
  costPaidUsd: number; // total incl commission
  slippageUsd: number; // modeled friction vs raw mid (half spread + slippage + commission)
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
const mean = (a: number[]): number => (a.length ? sum(a) / a.length : 0);

/** Model a realistic BUY fill: cross half the spread + eat slippage + pay commission.
 *  MODELED (no live chain) — every number is an estimate. Assumptions = config.fills. */
export function applyRealisticFill(limitPremium: number | null, contracts: number): RealisticFill {
  const a = DEFAULT_ASSUMPTIONS;
  const n = Math.max(0, contracts);
  const mid = Math.max(0.01, limitPremium ?? 0.01);
  const frictionPct = (a.bidAskSpreadPct / 2 + a.slippagePct) / 100; // half spread + slippage
  const fillPremium = round2(mid * (1 + frictionPct));
  const costPerContractUsd = round2(fillPremium * 100);
  const commission = a.commissionPerContract * n;
  const costPaidUsd = round2(costPerContractUsd * n + commission);
  const slippageUsd = round2((fillPremium - mid) * 100 * n + commission);
  return { fillPremium, costPerContractUsd, costPaidUsd, slippageUsd };
}

// --- Expectancy over closed paper trades -----------------------------------------
type Regime = 'up' | 'down' | 'flat';
function regimeBucket(closed: ClosedTrade[], regime: Regime): { trades: number; expectancyR: number } {
  const rs = closed.filter((t) => t.regime === regime);
  return { trades: rs.length, expectancyR: round2(mean(rs.map((t) => t.rMultiple))) };
}

/** R-multiple expectancy, profit factor, and by-regime breakdown over closed trades.
 *  `proven` = enough sample AND positive expectancy AND no losing regime bucket. */
export function computeExpectancy(closed: ClosedTrade[]): ExpectancyStats {
  const trades = closed.length;
  const byRegime = { up: regimeBucket(closed, 'up'), down: regimeBucket(closed, 'down'), flat: regimeBucket(closed, 'flat') };
  if (trades === 0) {
    return { trades: 0, winRate: 0, avgWin: 0, avgLoss: 0, expectancyR: 0, profitFactor: 0, avgHoldMinutes: 0, byRegime, sampleSizeAdequate: false, proven: false };
  }
  const wins = closed.filter((t) => t.result === 'win');
  const losses = closed.filter((t) => t.result === 'loss');
  const winRate = wins.length / trades;
  const avgWin = mean(wins.map((t) => t.rMultiple));
  const avgLoss = mean(losses.map((t) => t.rMultiple)); // negative
  const expectancyR = mean(closed.map((t) => t.rMultiple));
  const grossWin = sum(wins.map((t) => Math.max(0, t.pnlUsd)));
  const grossLoss = Math.abs(sum(losses.map((t) => Math.min(0, t.pnlUsd))));
  const profitFactor = grossLoss > 0 ? Math.min(999, round2(grossWin / grossLoss)) : (grossWin > 0 ? 999 : 0);
  const avgHoldMinutes = round2(mean(closed.map((t) => t.holdMinutes)));
  const sampleSizeAdequate = trades >= config.risk.minPaperTrades;
  const noLosingRegime = (['up', 'down', 'flat'] as Regime[]).every((k) => byRegime[k].trades === 0 || byRegime[k].expectancyR >= 0);
  const proven = sampleSizeAdequate && expectancyR > 0 && noLosingRegime;
  return {
    trades, winRate: round2(winRate), avgWin: round2(avgWin), avgLoss: round2(avgLoss),
    expectancyR: round2(expectancyR), profitFactor, avgHoldMinutes, byRegime, sampleSizeAdequate, proven,
  };
}

/** Prove-it gate: may we make ANY performance/live CLAIM? Needs sample + positive
 *  expectancy + no losing regime bucket. Gates CLAIMS, never the alert stream. */
export function claimsAllowed(e: ExpectancyStats): boolean {
  return e.sampleSizeAdequate && e.trades >= config.risk.minPaperTrades && e.expectancyR > 0 && e.proven;
}
