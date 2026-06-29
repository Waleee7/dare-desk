// Persisted dashboard state. The scanner writes data/state.json after each run;
// the Next.js dashboard reads it. Keeps the bot (Node) and dashboard (Next)
// decoupled — no shared runtime, just a file.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EvaluationResult } from '../pipeline.js';
import type { JournalEntry } from '../journal/journal.js';
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
