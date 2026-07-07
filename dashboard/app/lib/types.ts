// Dashboard-side mirror of the bot's state contract (src/lib/state.ts is the
// source of truth — the writer defines the shape, this file just types the read).

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export type TrendDir = 'up' | 'down' | 'flat';
export interface TimeframeTrend {
  label: '15m' | '1h' | '4h' | '1D';
  dir: TrendDir;
  emaFast: number | null;
  emaSlow: number | null;
  rsi: number | null;
  pctFromEmaSlow: number | null;
}
export interface TrendSnapshot {
  ticker: string;
  asOf: string;
  timeframes: TimeframeTrend[];
  alignment: 'aligned-up' | 'aligned-down' | 'mixed';
  alignScore: number;
}

export interface KeyLevels {
  ticker: string;
  asOf: string;
  price: number;
  support: number[];
  resistance: number[];
  volumeNodes: number[];
  callWall: number | null;
  putWall: number | null;
  gammaMagnets: number[];
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevClose: number | null;
}

export interface VolumeStats {
  ticker: string;
  rvol: number | null;
  lastBarSurge: boolean;
  note: string;
}

export interface TickerChainLite {
  netFlowBias: 'bullish' | 'bearish' | 'mixed';
  putCallVolRatio: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaMagnets: number[];
  unusualStrikes: { strike: number; type: string; volOiRatio: number }[];
  note: string;
}

export interface TickerIntel {
  ticker: string;
  price: number | null;
  trend: TrendSnapshot | null;
  levels: KeyLevels | null;
  rvol: VolumeStats | null;
  chain: TickerChainLite | null;
  bars: { '5m': Bar[]; '1h': Bar[]; '1D': Bar[] };
}

export interface ExitEvent {
  at: string;
  etTime: string;
  kind: string;
  ticker: string;
  positionId: string;
  message: string;
  estPremium: number | null;
  premiumPct: number | null;
}

export interface Contract {
  ticker: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte?: number;
  bid?: number;
  ask?: number;
  iv?: number;
  openInterest?: number;
  volume?: number;
}

export interface PositionView {
  id: string;
  ticker: string;
  direction: 'long' | 'short';
  setup: string;
  tier: string;
  grade: string;
  contract: Contract;
  horizon: string;
  contracts: number;
  initialContracts: number;
  entryTimeEt: string;
  fillPremium: number;
  costPaidUsd: number;
  tp1Premium: number;
  tp2Premium: number;
  stopPremium: number;
  timeStopMin: number;
  zeroDte: boolean;
  status: 'open' | 'runner';
  lastEstPremium: number | null;
  lastUnderlying: number | null;
  plPct: number | null;
  plUsd: number | null;
  events: ExitEvent[];
}

export interface ClosedTrade {
  ticker: string;
  setup: string;
  tier: string;
  entryTimeEt: string;
  exitTimeEt: string;
  fillPremium: number;
  exitPremium: number;
  contracts: number;
  costPaidUsd: number;
  pnlUsd: number;
  rMultiple: number;
  holdMinutes: number;
  result: 'win' | 'loss';
  regime: 'up' | 'down' | 'flat';
}

export interface SignalRow {
  time: string;
  ticker: string;
  setup: string;
  timeframe: string;
  direction: string;
  contract: string;
  entry: number | null;
  stop: number | null;
  targets: number[];
  grade: string;
  total: number;
  confidence: number;
  rewardRisk: number | null;
  status: string;
  fired: boolean;
  blocks: string[];
  tier: string;
  entryTimeEt: string;
  costPaidUsd: number | null;
}

export interface JournalEntry {
  at: string;
  ticker: string;
  setup: string;
  grade: string;
  confidence: number;
  outcome: 'alerted' | 'watch' | 'skipped';
  approved: boolean;
  blocks: string[];
  brokerMessage: string;
}

export interface ExpectancyStats {
  trades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancyR: number;
  profitFactor: number;
  avgHoldMinutes: number;
  byRegime: Record<'up' | 'down' | 'flat', { trades: number; expectancyR: number }>;
  sampleSizeAdequate: boolean;
  proven: boolean;
}

export interface NewsRow {
  headline: string;
  source: string;
  url: string;
  at: string;
  symbols: string[];
  breaking: boolean;
}

export interface ArmedSignal {
  ticker: string;
  direction: 'long' | 'short';
  triggerLevel: number;
  price: number;
  distancePct: number;
  rvol: number;
  flowBias: 'bullish' | 'bearish' | 'mixed' | null;
  alignment: 'aligned-up' | 'aligned-down';
  why: string;
  etTime: string;
}

export interface DayView {
  date: string;
  realizedPnlUsd: number;
  peakPnlUsd: number;
  tradesToday: number;
  openPositionsCount: number;
  openRiskUsd: number;
  sizeMultiplier: number;
  standDownReason: string | null;
  cooldownUntil: number | null;
}

export interface DashboardState {
  brand: string;
  updatedAt: string;
  provider: string;
  scanned: number;
  signals: SignalRow[];
  journal: JournalEntry[];
  summary: { total: number; alerted: number; watched: number; skipped: number; topBlocks: string[] };
  headlines: string[];
  meta: {
    llm: string;
    newsProvider: string;
    scanIntervalSec: number;
    marketHours: string;
    accountSizeUsd: number;
    maxRiskPerTradePct: number;
    maxDailyLossPct: number;
    liveTrading: boolean;
  };
  expectancy: ExpectancyStats;
  proveIt: { proven: boolean; paperTrades: number; needed: number };
  dayType?: 'trend-up' | 'trend-down' | 'range' | 'forming';
  day?: DayView;
  positions?: PositionView[];
  exitEvents?: ExitEvent[];
  closedTrades?: ClosedTrade[];
  intel?: Record<string, TickerIntel>;
  news?: NewsRow[];
  armed?: ArmedSignal[];
}
