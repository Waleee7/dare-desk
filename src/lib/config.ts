import 'dotenv/config';
import type { FactorName } from './types.js';

const num = (v: string | undefined, d: number): number => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  // Bot identity — used in alerts + dashboard. Change here (or BOT_NAME env) to rebrand.
  botName: process.env.BOT_NAME || 'DARE Desk',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  scorerModel: process.env.SCORER_MODEL || 'claude-opus-4-8',
  parserModel: process.env.PARSER_MODEL || 'claude-opus-4-8',
  scorerEffort: (process.env.SCORER_EFFORT || 'low') as 'low' | 'medium' | 'high' | 'max',

  risk: {
    accountSizeUsd: num(process.env.ACCOUNT_SIZE_USD, 10_000),
    maxRiskPerTradePct: num(process.env.MAX_RISK_PER_TRADE_PCT, 1),
    maxDailyLossPct: num(process.env.MAX_DAILY_LOSS_PCT, 3),
    maxTradesPerDay: num(process.env.MAX_TRADES_PER_DAY, 5),
    maxConsecutiveLosses: num(process.env.MAX_CONSECUTIVE_LOSSES, 2),
    cooldownMinutes: num(process.env.COOLDOWN_MINUTES, 45),
    minRewardRisk: num(process.env.MIN_REWARD_RISK, 1.5),
    maxSpreadPct: num(process.env.MAX_SPREAD_PCT, 8),
    minRegimeScore: num(process.env.MIN_REGIME_SCORE, 50),
  },

  liveTrading: (process.env.LIVE_TRADING || 'false').toLowerCase() === 'true',
  robinhoodMcpUrl: process.env.ROBINHOOD_MCP_URL || 'https://agent.robinhood.com/mcp/trading',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  // Separate "Watching" channel (WATCH-grade setups). Falls back to the main
  // webhook if unset, so one webhook still works.
  discordWatchWebhookUrl: process.env.DISCORD_WATCH_WEBHOOK_URL || '',

  // Market-data feed. Robinhood has NO data API (execution-only), so the live
  // feed comes from Alpaca: free + real-time IEX for the underlyings.
  alpaca: {
    key: process.env.ALPACA_API_KEY || '',
    secret: process.env.ALPACA_SECRET || '',
    feed: process.env.ALPACA_FEED || 'iex', // free tier = iex (real-time)
  },
  // Backup verified-news feed (free). Alpaca News (Benzinga) is primary.
  alphaVantageKey: process.env.ALPHAVANTAGE_API_KEY || '',

  // Continuous runner ("go"): scan cadence + whether to run outside RTH.
  scanIntervalSec: num(process.env.SCAN_INTERVAL_SEC, 120),
  runOffHours: (process.env.RUN_OFFHOURS || 'false').toLowerCase() === 'true',
} as const;

/** Confluence weights, summing to 100 (Strategy Edge Governor spec). */
export const WEIGHTS: Record<FactorName, number> = {
  technical: 25,
  regime: 20,
  news: 15,
  optionsChain: 15,
  riskReward: 15,
  joshLens: 10,
};

/** Governor grade thresholds (on the EARNED confidence %, 0-100).
 *  SIGNAL = the only tier that fires to Discord (A+ and ALERT merged into one). */
export const GRADE_THRESHOLDS = {
  SIGNAL: 85, // 🚨 fires — earned confidence must clear 85%
  WATCH: 65,  // 👀 watch channel / dashboard only
} as const;

export const hasLLM = (): boolean => config.anthropicApiKey.length > 0;
