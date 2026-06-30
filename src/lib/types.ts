// Shared domain types for the PremiumFloor decision engine.

export type Direction = 'long' | 'short'; // calls = long, puts = short bias
export type OptionType = 'call' | 'put';
export type Timeframe = 'scalp' | 'intraday' | 'swing';

/** Raw inbound alert from the friend's bot (Discord "Schwab alerts"). */
export interface RawAlert {
  id: string;
  source: string; // channel name, e.g. "schwab-alerts"
  text: string; // verbatim message
  receivedAt: string; // ISO
}

/** An options contract. Prices in dollars; strike in dollars. */
export interface Contract {
  ticker: string;
  optionType: OptionType;
  strike: number;
  expiry: string; // YYYY-MM-DD
  dte?: number; // days to expiry (0 = same-day) — set by the contract selector
  // Optional chain detail (filled by a market-data provider in Phase 2):
  bid?: number;
  ask?: number;
  delta?: number;
  iv?: number;
  openInterest?: number;
  volume?: number;
}

/** A structured trade idea, parsed from a RawAlert. Prices are underlying $. */
export interface TradeIdea {
  alertId: string;
  ticker: string;
  direction: Direction;
  setup: string; // e.g. "VWAP reclaim", "unusual flow", "RSI oversold"
  contract: Contract;
  entry: number | null; // underlying entry zone midpoint
  stop: number | null; // underlying stop
  targets: number[]; // underlying targets
  premium: number | null; // option premium (per share)
  catalyst?: string; // news/flow note if present
  rawConfidence?: number; // bot's own confidence if it stated one (0-10)
  timeframe?: Timeframe; // scalp | intraday | swing (derived from MTF horizon)
  // Multi-timeframe confirmation (Stage 2): which bar intervals agree on direction.
  mtf?: { timeframes: string[]; agreement: number; conflict: boolean };
  notes?: string;
}

/** External conditions a scorer may read. Phase 2 fills these from real feeds. */
export interface MarketContext {
  asOf: string; // ISO
  spyTrend: 'up' | 'down' | 'flat';
  qqqTrend: 'up' | 'down' | 'flat';
  vix: number;
  vixTrend: 'up' | 'down' | 'flat';
  breadth: number; // -1..1 (advancers vs decliners proxy)
  fearGreed: number; // 0-100 (CNN-style)
  putCallRatio?: number;
  headlines: string[]; // recent market/ticker headlines
  eventRiskToday: boolean; // CPI/FOMC/Powell/jobs or surprise
  earningsSoon: boolean; // earnings today/tomorrow for the ticker
}

export type FactorName =
  | 'technical'
  | 'joshLens'
  | 'regime'
  | 'news'
  | 'optionsChain'
  | 'riskReward';

/** One lens's output. `score` is 0-100 on that factor's own axis. */
export interface FactorScore {
  factor: FactorName;
  score: number; // 0-100
  rationale: string;
  flags: string[]; // machine-readable signals (e.g. "wide_spread", "event_risk")
  source: 'llm' | 'heuristic'; // did the LLM run, or did we fall back?
}

export interface ScoreBreakdown {
  factors: Record<FactorName, FactorScore>;
  /** Weighted total out of 100 (governor computes this). */
  total: number;
  /** EARNED confidence 0-100 — the weighted total capped by how much real
   *  confluence (regime/news/MTF/chain) backs it. This is the number that grades. */
  confidence: number;
  confluenceCount: number; // how many factors materially agree (>=60)
}

// A+ = highest-conviction (>=92 earned confidence): fires loud, leans in.
// SIGNAL = fires (>=80). WATCH = observe (65-79). REJECT = no-trade (<65).
export type Grade = 'A+' | 'SIGNAL' | 'WATCH' | 'REJECT';

export interface GovernorDecision {
  grade: Grade;
  total: number;
  confidence: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
}

export interface FirewallResult {
  approved: boolean;
  blocks: string[]; // hard-block reasons (empty when approved)
  warnings: string[];
  positionContracts: number;
  maxLossUsd: number;
  stop: number | null;
  targets: number[];
  rewardRisk: number | null;
}

/** Mutable per-day risk state the firewall reads + updates. */
export interface DayState {
  date: string; // YYYY-MM-DD
  tradesToday: number;
  realizedPnlUsd: number;
  consecutiveLosses: number;
  cooldownUntil: number | null; // epoch ms
}

/** One premium-based exit level (what you actually trade — the contract, not the stock). */
export interface PremiumExit {
  label: string; // 'TP1 · base hit' | 'TP2 · runner' | 'Stop'
  premium: number; // estimated option premium at this level ($/share)
  premiumPct: number; // % change in premium from entry (+15, +40, -25)
  underlying: number | null; // the underlying price this corresponds to
  action: string; // 'Sell half, lock it in' | 'Trail the rest' | 'Cut it — thesis dead'
}

/** The Exit Brain output — every signal carries one. Answers: how long do I hold,
 *  where do I take profit (in premium %), what makes me bail, when is it just dead. */
export interface ExitPlan {
  style: 'scalp' | 'runner' | 'swing'; // the personality of THIS trade
  holdWindow: string; // human-readable: 'Out in ~5–15 min' / '30–90 min, flat by EOD'
  timeStopMin: number; // hard time-stop in minutes (0 = manage by level, no clock)
  takeProfits: PremiumExit[]; // TP1 base-hit, TP2 runner
  stop: PremiumExit; // premium-based stop
  trail: string; // what to do after TP1 hits
  runnerTrigger: string; // what justifies holding for the +big runner (breakout/volume)
  invalidation: string; // the level/condition that kills the trade NOW
}

export type AlertStatus = 'watch' | 'paper' | 'approval' | 'live-disabled' | 'rejected';

export interface PremiumFloorAlert {
  kind: 'alert' | 'rejection';
  ticker: string;
  direction: Direction;
  setup: string;
  contract: Contract;
  entry: number | null;
  stop: number | null;
  targets: number[];
  confidence: number;
  grade: Grade;
  why: string[];
  risk: string;
  status: AlertStatus;
  // Stage 1 additions — contract guidance + context surfaced in the alert.
  contractStyle: string; // e.g. "0DTE (same-day)" / "3DTE" / "7DTE"
  tradeLength: string; // e.g. "Quick scalp · minutes" / "5–30 min" / "Hours to days"
  newsContext: string; // regime + event/earnings + top headline
  exitPlan: ExitPlan; // Exit Brain: hold window, premium-based TPs, stop, invalidation
  text: string; // rendered, Discord-ready
}

export interface BrokerOrder {
  ideaId: string;
  ticker: string;
  optionType: OptionType;
  strike: number;
  expiry: string;
  contracts: number;
  limitPremium: number | null;
  stop: number | null;
  targets: number[];
  maxLossUsd: number;
}

export type BrokerMode = 'paper' | 'approval' | 'live';

export interface BrokerResult {
  accepted: boolean;
  mode: BrokerMode;
  message: string;
  orderId?: string;
}
