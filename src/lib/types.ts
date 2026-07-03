// Shared domain types for the PremiumFloor decision engine.

export type Direction = 'long' | 'short'; // calls = long, puts = short bias
export type OptionType = 'call' | 'put';
export type Timeframe = 'scalp' | 'intraday' | 'swing';
/** Universe tier — sets the alert bar. Extended names require A+ (>=90). */
export type Tier = 'core' | 'focus' | 'extended';

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

// --- Multi-timeframe trend engine (the "which way is the chart actually going" layer) ---

export type TrendDir = 'up' | 'down' | 'flat';
export type TrendLabel = '15m' | '1h' | '4h' | '1D';

/** One timeframe's trend read: EMA9 vs EMA21 vs price, with RSI for context. */
export interface TimeframeTrend {
  label: TrendLabel;
  dir: TrendDir;
  emaFast: number | null; // EMA9
  emaSlow: number | null; // EMA21
  rsi: number | null;
  pctFromEmaSlow: number | null; // how extended price is vs the slow EMA (%)
}

/** Higher-timeframe trend stack for a ticker — 15m/1h/4h/1D + alignment. */
export interface TrendSnapshot {
  ticker: string;
  asOf: string;
  timeframes: TimeframeTrend[];
  alignment: 'aligned-up' | 'aligned-down' | 'mixed';
  alignScore: number; // up-TF count minus down-TF count (-4..+4)
}

// --- Key levels: where the walls are (price structure + options positioning) ---

/** The levels that matter for a ticker right now. Support/resistance come from
 *  swing structure + volume nodes + prior-day levels; call/put walls come from
 *  the DELAYED options chain (biggest OI strikes — dealer-hedging magnets). */
export interface KeyLevels {
  ticker: string;
  asOf: string;
  price: number; // reference price when computed
  support: number[]; // below price, nearest first
  resistance: number[]; // above price, nearest first
  volumeNodes: number[]; // top high-volume price areas (volume profile peaks)
  callWall: number | null; // biggest call-OI strike at/above price (delayed chain)
  putWall: number | null; // biggest put-OI strike at/below price (delayed chain)
  gammaMagnets: number[]; // OI-cluster strikes price tends to pin toward
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevClose: number | null;
}

/** Relative volume — is real participation behind the move, or is the tape dead? */
export interface VolumeStats {
  ticker: string;
  rvol: number | null; // today's volume pace vs the 20-day average (1.0 = normal)
  lastBarSurge: boolean; // latest bar printed > 1.3x its 20-bar average
  note: string;
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
  tier?: Tier; // core (QQQ/SPY) | focus (mag7+semis) | extended (everything else)
  // Multi-timeframe confirmation (Stage 2): which bar intervals agree on direction.
  mtf?: { timeframes: string[]; agreement: number; conflict: boolean };
  // Intelligence layer (2026-07): higher-TF trend stack, walls/levels, participation.
  trend?: TrendSnapshot;
  levels?: KeyLevels;
  rvol?: VolumeStats;
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
  /** Intraday character of TODAY'S tape (not the daily trend): trend days reward
   *  continuation, range days shred breakouts. 'forming' = too early to call. */
  dayType?: 'trend-up' | 'trend-down' | 'range' | 'forming';
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

// Letter grades on EARNED confidence: A+ >=90 (lean-in), A >=80 (fires),
// B >=70 (watch), C >=60 (watch/log), D <60 (no-trade).
// Core/Focus fire at A; Extended-universe names require A+ (>=90).
export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D';

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

/** Mutable per-day risk state the firewall reads + updates. PERSISTED to
 *  data/day.json — a restart must never amnesia the limits protecting the book. */
export interface DayState {
  date: string; // YYYY-MM-DD
  tradesToday: number;
  realizedPnlUsd: number;
  peakPnlUsd: number; // high-water mark of the day (drives the profit lock)
  consecutiveLosses: number;
  cooldownUntil: number | null; // epoch ms
  cooldownCount: number; // loss-streak cooldowns triggered today (2nd = done for the day)
  cooldownByTicker: Record<string, number>; // ticker -> epoch ms lock (revenge-trade guard)
  openClusters: Record<string, number>; // correlation cluster -> open same-direction count (heat cap)
  openPositionsCount: number; // live paper positions on (aggregate cap)
  openRiskUsd: number; // total premium at risk across open positions (aggregate cap)
  sizeMultiplier: number; // 1 normally; 0.5 after a red-day streak until a green day
  standDownReason: string | null; // set at day-roll (e.g. weekly breaker) — blocks all fires
  closed: ClosedTrade[]; // closed paper trades this session (feeds expectancy)
}

/** One finished day, persisted to data/dayHistory.json — fuels the weekly breaker
 *  and the red-streak half-size rule. */
export interface DaySummary {
  date: string;
  realizedPnlUsd: number;
  trades: number;
}

/** A closed paper trade — the unit expectancy is computed from. All fills MODELED. */
export interface ClosedTrade {
  ticker: string;
  setup: string;
  tier: Tier;
  entryTimeEt: string;
  exitTimeEt: string;
  fillPremium: number; // per-share premium (modeled) paid at entry
  exitPremium: number; // per-share premium (modeled) at exit
  contracts: number;
  costPaidUsd: number;
  pnlUsd: number;
  rMultiple: number;
  holdMinutes: number;
  result: 'win' | 'loss';
  regime: 'up' | 'down' | 'flat';
}

/** Expectancy over closed trades. Drives the prove-it gate + EOD recap. */
export interface ExpectancyStats {
  trades: number;
  winRate: number; // 0-1
  avgWin: number; // R multiples (positive)
  avgLoss: number; // R multiples (negative)
  expectancyR: number; // per-trade expectancy in R
  profitFactor: number;
  avgHoldMinutes: number;
  byRegime: Record<'up' | 'down' | 'flat', { trades: number; expectancyR: number }>;
  sampleSizeAdequate: boolean; // trades >= config.risk.minPaperTrades
  proven: boolean; // sampleSizeAdequate && expectancyR>0 && no negative regime bucket
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
  tier: Tier; // core | focus | extended (Extended surfaces only at A+)
  entryTimeEt: string; // HH:MM:SS ET the signal fired (entry ticket)
  costPerContractUsd: number | null; // modeled premium paid per contract
  costPaidUsd: number | null; // modeled total for the position
  timeToFlat: string; // exit timeframe / be-flat-by (EOD for 0DTE)
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
  entryTimeEt: string; // HH:MM:SS ET stamped when the order is built (entry ticket)
}

// --- Exit monitor: open paper positions + the events they emit -------------------

export type ExitEventKind =
  | 'opened' // paper fill recorded, monitor is watching it
  | 'approaching_tp1' // premium within reach of TP1 — "looking to take the base hit"
  | 'tp1_scaled' // TP1 hit — half banked, runner stays on, stop → breakeven
  | 'approaching_stop' // premium near the stop — "looking to get out"
  | 'stopped' // stop hit — full exit
  | 'target_hit' // TP2 / runner target hit — full exit
  | 'time_stop' // hold window expired — out on the clock
  | 'flat_by_close'; // 0DTE flat-by / end-of-day discipline exit

/** One exit-monitor transition — rendered to Discord (#trade-management) + dashboard. */
export interface ExitEvent {
  at: string; // ISO
  etTime: string; // HH:MM:SS ET
  kind: ExitEventKind;
  ticker: string;
  positionId: string;
  message: string; // human, Discord-ready one-liner
  estPremium: number | null; // modeled premium at event time
  premiumPct: number | null; // vs entry fill (+31 = up 31%)
}

/** An open MODELED paper position the exit monitor manages. Persisted to
 *  data/positions.json so a runner restart never orphans a trade. */
export interface OpenPosition {
  id: string; // broker orderId
  ticker: string;
  direction: Direction;
  setup: string;
  tier: Tier;
  grade: Grade;
  contract: Contract;
  horizon: Timeframe;
  contracts: number; // remaining on (after a TP1 scale-out: the runner half)
  initialContracts: number;
  entryTimeEt: string;
  openedAtMs: number;
  minutesToCloseAtEntry: number; // session minutes left when opened — theta clock
  entryUnderlying: number | null;
  fillPremium: number; // modeled per-share entry fill
  costPaidUsd: number;
  delta: number; // modeled delta — drives the premium re-quote
  // Exit plan in PREMIUM terms (what we actually manage by):
  tp1Premium: number;
  tp2Premium: number;
  stopPremium: number; // moves to breakeven (fillPremium) after TP1
  timeStopMin: number; // 0 = manage by level only
  zeroDte: boolean;
  status: 'open' | 'runner'; // runner = TP1 banked, rest riding
  scaledOutPremium: number | null; // premium banked on the TP1 half
  warnedTp1: boolean;
  warnedStop: boolean;
  regime: 'up' | 'down' | 'flat'; // regime at entry (expectancy bucket)
  lastEstPremium: number | null;
  lastUnderlying: number | null;
  events: ExitEvent[];
}

export type BrokerMode = 'paper' | 'approval' | 'live';

export interface BrokerResult {
  accepted: boolean;
  mode: BrokerMode;
  message: string;
  orderId?: string;
  // Modeled fill economics (paper). All estimates — no live options chain.
  fillPremium?: number; // per-share premium after modeled spread + slippage
  costPerContractUsd?: number; // fillPremium * 100
  costPaidUsd?: number; // total incl commission
  slippageUsd?: number; // modeled slippage cost
}
