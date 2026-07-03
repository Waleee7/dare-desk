import 'dotenv/config';
import type { FactorName } from './types.js';

const num = (v: string | undefined, d: number): number => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Parse "580-660,840-915" into ET-minute windows. Bad input → no windows (gate off). */
function parseWindows(s: string): { startMin: number; endMin: number }[] {
  return s.split(',')
    .map((w) => w.trim().split('-').map(Number))
    .filter((p): p is [number, number] => p.length === 2 && p.every((n) => Number.isFinite(n)) && p[0]! < p[1]!)
    .map(([startMin, endMin]) => ({ startMin, endMin }));
}

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
    // 0 = unlimited signals (Josh's call: "signal as many as it wants"). The
    // daily-LOSS circuit breaker + loss-streak cooldown still protect the account;
    // this only governs the *count*, not capital at risk. Set >0 to cap again.
    maxTradesPerDay: num(process.env.MAX_TRADES_PER_DAY, 0),
    maxConsecutiveLosses: num(process.env.MAX_CONSECUTIVE_LOSSES, 2),
    cooldownMinutes: num(process.env.COOLDOWN_MINUTES, 45),
    minRewardRisk: num(process.env.MIN_REWARD_RISK, 1.5),
    maxSpreadPct: num(process.env.MAX_SPREAD_PCT, 8),
    minRegimeScore: num(process.env.MIN_REGIME_SCORE, 50),
    // Universe + discipline upgrades (2026-07 build)
    extendedMinConfidence: num(process.env.EXTENDED_MIN_CONF, 90), // Extended names need A+ (>=90)
    chaseGuardPct: num(process.env.CHASE_GUARD_PCT, 0.4), // block if price left entry by >0.4%
    maxCorrelatedHeat: num(process.env.MAX_CORRELATED_HEAT, 2), // max same-dir open trades per cluster
    nameCooldownMinutes: num(process.env.NAME_COOLDOWN_MIN, 20), // per-ticker lock after a loss
    lunchStartMinEt: num(process.env.LUNCH_START, 690), // 11:30 ET (minutes past ET midnight)
    lunchEndMinEt: num(process.env.LUNCH_END, 810), // 13:30 ET
    suppressLunch: (process.env.SUPPRESS_LUNCH || 'true').toLowerCase() === 'true',
    minPaperTrades: num(process.env.MIN_PAPER_TRADES, 100), // prove-it gate sample size
    zeroDteFlatByMinEt: num(process.env.ZERO_DTE_FLAT, 955), // 15:55 ET — be flat on 0DTE
    // Discipline upgrades (2026-07 Tier 1+2 build) — all env-tunable.
    maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 5), // concurrent paper positions cap
    maxOpenRiskPct: num(process.env.MAX_OPEN_RISK_PCT, 3), // total open premium-at-risk cap (% of account)
    profitLockTriggerPct: num(process.env.PROFIT_LOCK_TRIGGER_PCT, 2), // arm the give-back guard at +2% day
    profitLockGivebackPct: num(process.env.PROFIT_LOCK_GIVEBACK_PCT, 50), // stand down if 50% of peak gives back
    weeklyBreakerLossPct: num(process.env.WEEKLY_BREAKER_LOSS_PCT, 6), // rolling 5-day realized loss → stand down
    redStreakHalfSizeDays: num(process.env.RED_STREAK_DAYS, 3), // consecutive red days → half-size until green
    openingGuardMin: num(process.env.OPENING_GUARD_MIN, 10), // no fresh fires the first N min (0 = off)
    thetaBudgetPct: num(process.env.THETA_BUDGET_PCT, 35), // block if decay over the hold eats >35% of TP1 gain
    refireCooldownMin: num(process.env.REFIRE_COOLDOWN_MIN, 45), // same ticker+setup+direction re-fire lock
    // 0DTE entries only inside the gamma windows (ET minutes): open drive + power hour.
    zeroDteWindows: parseWindows(process.env.ZERO_DTE_WINDOWS || '580-660,840-915'),
  },

  liveTrading: (process.env.LIVE_TRADING || 'false').toLowerCase() === 'true',
  robinhoodMcpUrl: process.env.ROBINHOOD_MCP_URL || 'https://agent.robinhood.com/mcp/trading',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  // Separate "Watching" channel (WATCH-grade setups). Falls back to the main
  // webhook if unset, so one webhook still works.
  discordWatchWebhookUrl: process.env.DISCORD_WATCH_WEBHOOK_URL || '',
  // Multi-channel server layout (all optional — everything falls back gracefully):
  //   #trade-management — exit monitor talk + EOD recap (falls back to main)
  //   #news             — breaking headlines (silent when unset; no spam fallback)
  //   #mag7             — fires on mag7/semis names cross-post here (optional)
  //   #spy-qqq          — fires on index ETFs cross-post here (optional)
  discordTradeMgmtWebhookUrl: process.env.DISCORD_TRADE_MGMT_WEBHOOK_URL || '',
  discordNewsWebhookUrl: process.env.DISCORD_NEWS_WEBHOOK_URL || '',
  discordMag7WebhookUrl: process.env.DISCORD_MAG7_WEBHOOK_URL || '',
  discordIndexWebhookUrl: process.env.DISCORD_INDEX_WEBHOOK_URL || '',

  // Market-data feed. Robinhood has NO data API (execution-only), so the live
  // feed comes from Alpaca: free + real-time IEX for the underlyings.
  alpaca: {
    key: process.env.ALPACA_API_KEY || '',
    secret: process.env.ALPACA_SECRET || '',
    feed: process.env.ALPACA_FEED || 'iex', // free tier = iex (real-time)
  },
  // Backup verified-news feed (free). Alpaca News (Benzinga) is primary.
  alphaVantageKey: process.env.ALPHAVANTAGE_API_KEY || '',
  // Additional free, verified sources: Finnhub (news+earnings+econ), FMP (news+calendar),
  // FRED (official macro: yields/rates/dollar). All key-guarded + never-throw.
  finnhubKey: process.env.FINNHUB_API_KEY || '',
  fmpKey: process.env.FMP_API_KEY || '',
  fredKey: process.env.FRED_API_KEY || '',
  // SINGLE source of paper-fill assumptions (backtest + PaperBroker read this).
  // All MODELED — no live options chain. Numbers are estimates, labeled as such.
  fills: {
    bidAskSpreadPct: num(process.env.FILL_SPREAD_PCT, 5), // modeled round-trip spread %
    slippagePct: num(process.env.FILL_SLIPPAGE_PCT, 1.5), // modeled slippage %
    commissionPerContract: num(process.env.FILL_COMMISSION, 0.65), // $/contract
  },

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
 *  A+ and SIGNAL both fire to the signals channel; A+ is the lean-in tier. */
/** Governor letter-grade thresholds on EARNED confidence %. A+/A fire; B/C watch; D no-trade.
 *  Core/Focus fire at A (>=80); Extended-universe names require A+ (>=90). */
export const GRADE_THRESHOLDS = {
  APLUS: num(process.env.GRADE_APLUS, 90), // 🔥 A+ — lean in; also the Extended-universe bar
  A: num(process.env.GRADE_A, 80),         // 🚨 A — fires (Core/Focus)
  B: num(process.env.GRADE_B, 70),         // 👀 B — watch channel
  C: num(process.env.GRADE_C, 60),         // 👀 C — watch/log; below = D (no-trade)
} as const;

export const hasLLM = (): boolean => config.anthropicApiKey.length > 0;

/** Correlation clusters for the heat cap — QQQ/NVDA/SMH long is ONE trade, not many.
 *  The firewall caps simultaneous same-direction exposure per cluster. */
export const CLUSTER_OF: Record<string, string> = {
  QQQ: 'semis-nasdaq', NVDA: 'semis-nasdaq', AMD: 'semis-nasdaq', AVGO: 'semis-nasdaq',
  MU: 'semis-nasdaq', SMH: 'semis-nasdaq', SOXL: 'semis-nasdaq', TSM: 'semis-nasdaq',
  AAPL: 'mega-tech', MSFT: 'mega-tech', GOOGL: 'mega-tech', GOOG: 'mega-tech',
  AMZN: 'mega-tech', META: 'mega-tech', TSLA: 'mega-tech',
  SPY: 'broad', DIA: 'broad', IWM: 'broad',
};

/** Cluster for a ticker (defaults to the symbol itself = its own cluster). */
export const clusterOf = (ticker: string): string =>
  CLUSTER_OF[ticker.toUpperCase()] ?? ticker.toUpperCase();
