// Persisted dashboard state. The scanner writes data/state.json after each run;
// the Next.js dashboard reads it. Keeps the bot (Node) and dashboard (Next)
// decoupled — no shared runtime, just a file.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EvaluationResult } from '../pipeline.js';
import type { JournalEntry } from '../journal/journal.js';
import type {
  ExpectancyStats, OpenPosition, ExitEvent, ClosedTrade,
  TrendSnapshot, KeyLevels, VolumeStats, MarketContext,
} from './types.js';
import type { Bar } from '../data/provider.js';
import { config, hasLLM } from './config.js';
import { newsProviderName } from '../news/index.js';

export interface DashboardMeta {
  llm: string;
  newsProvider: string;
  scanIntervalSec: number;
  marketHours: string;
  accountSizeUsd: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  liveTrading: boolean;
}

/** Snapshot of the bot's config for the dashboard Settings tab. */
export function dashboardMeta(): DashboardMeta {
  return {
    llm: hasLLM() ? config.scorerModel : 'heuristic (no key)',
    newsProvider: newsProviderName(),
    scanIntervalSec: config.scanIntervalSec,
    marketHours: 'ET 9:30–16:00 · Mon–Fri',
    accountSizeUsd: config.risk.accountSizeUsd,
    maxRiskPerTradePct: config.risk.maxRiskPerTradePct,
    maxDailyLossPct: config.risk.maxDailyLossPct,
    liveTrading: config.liveTrading,
  };
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
  rMultiple: number | null; // set when the paper trade closes
  result: string; // '' | 'win' | 'loss'
}

/** An open position as the dashboard sees it — live P/L attached. */
export type PositionView = OpenPosition & { plPct: number | null; plUsd: number | null };

/** Compact per-ticker chain read (the full snapshot is too heavy for state.json). */
export interface TickerChainLite {
  netFlowBias: 'bullish' | 'bearish' | 'mixed';
  putCallVolRatio: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaMagnets: number[];
  unusualStrikes: { strike: number; type: string; volOiRatio: number }[];
  note: string;
}

/** Everything the Charts tab needs for one ticker: candles + the intelligence layer. */
export interface TickerIntel {
  ticker: string;
  price: number | null;
  trend: TrendSnapshot | null;
  levels: KeyLevels | null;
  rvol: VolumeStats | null;
  chain: TickerChainLite | null;
  bars: { '5m': Bar[]; '1h': Bar[]; '1D': Bar[] };
}

export interface NewsRow {
  headline: string;
  source: string;
  url: string;
  at: string;
  symbols: string[];
  breaking: boolean;
}

/** The day's risk posture — what the firewall is enforcing right now. */
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
  summary: ReturnType<import('../journal/journal.js').TradeJournal['summary']>;
  headlines: string[];
  meta: DashboardMeta;
  expectancy: ExpectancyStats;
  proveIt: { proven: boolean; paperTrades: number; needed: number };
  // 2026-07 dashboard contract (optional — one-shot writers may omit them):
  dayType?: MarketContext['dayType'];
  day?: DayView;
  positions?: PositionView[];
  exitEvents?: ExitEvent[];
  closedTrades?: ClosedTrade[];
  intel?: Record<string, TickerIntel>;
  news?: NewsRow[];
}

const STATE_PATH = join(process.cwd(), 'data', 'state.json');

export function rowFrom(r: EvaluationResult): SignalRow {
  const c = r.idea.contract;
  return {
    time: new Date().toISOString(),
    ticker: r.idea.ticker,
    setup: r.idea.setup,
    timeframe: r.idea.timeframe ?? 'intraday',
    direction: r.idea.direction,
    contract: `${c.ticker} ${c.strike}${c.optionType === 'call' ? 'C' : 'P'} ${c.expiry}`.trim(),
    entry: r.idea.entry,
    stop: r.firewall.stop,
    targets: r.firewall.targets,
    grade: r.decision.grade,
    total: r.decision.total,
    confidence: r.decision.confidence,
    rewardRisk: r.firewall.rewardRisk,
    status: r.alert.status,
    fired: r.firewall.approved,
    blocks: r.firewall.blocks,
    tier: r.alert.tier,
    entryTimeEt: r.alert.entryTimeEt,
    costPaidUsd: r.alert.costPaidUsd,
    rMultiple: null,
    result: '',
  };
}

export function writeState(s: DashboardState): void {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
}

export function readState(): DashboardState | null {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as DashboardState;
  } catch {
    return null;
  }
}
