// The pipeline — wires all components into one decision flow:
// ingest → parse → score(6) → govern → firewall → alert → broker → journal.
//
// The engine's protective state is PERSISTENT: day risk state lives in
// data/day.json (+ data/dayHistory.json for the weekly breaker), the journal in
// data/journal.json / data/closed.json — a restart must never resurrect the
// exposure (positions.json) while amnesing the limits that were protecting it.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketContext, TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, BrokerResult, ClosedTrade, Tier, DayState, DaySummary, OpenPosition } from './lib/types.js';
import { makeRawAlert, storeRawAlert } from './ingest/store.js';
import { parseAlert } from './ingest/parseAlert.js';
import { scoreAll } from './scoring/index.js';
import { governDecision } from './engine/governor.js';
import { runFirewall, freshDay, recordTradeResult, riskAtStopUsd } from './engine/firewall.js';
import { SignalRegistry } from './engine/signalRegistry.js';
import { buildAlert } from './discord/alert.js';
import { selectBroker, toOrder } from './broker/index.js';
import { TradeJournal, type JournalEntry } from './journal/journal.js';
import { claimsAllowed } from './backtest/index.js';
import { config, clusterOf } from './lib/config.js';
import { etMinutes, nowEt } from './lib/clock.js';
import { estDelta, premiumAt } from './scan/contracts.js';

export interface EvaluationResult {
  idea: TradeIdea;
  decision: GovernorDecision;
  firewall: FirewallResult;
  alert: PremiumFloorAlert;
  broker: BrokerResult | null;
  journalEntry: JournalEntry;
}

export interface EvaluateOpts {
  source?: string;
  /** Explicit live-broker unlock (still requires LIVE_TRADING=true + prove-it). Default false. */
  unlock?: boolean;
}

export interface EngineOpts {
  /** Live quote fn — powers the chase guard + fill re-basing. Omit for tests/one-shots. */
  quote?: (ticker: string) => Promise<{ price: number }>;
  /** Where day/journal state persists. Defaults to ./data. */
  dataDir?: string;
}

const etToday = (now = new Date()): string => {
  const d = nowEt(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class PremiumFloorEngine {
  readonly journal: TradeJournal;
  private day: DayState;
  private history: DaySummary[] = [];
  private readonly registry = new SignalRegistry();
  private readonly quote?: EngineOpts['quote'];
  private readonly dayPath: string;
  private readonly historyPath: string;

  constructor(opts: EngineOpts = {}) {
    const dataDir = opts.dataDir ?? join(process.cwd(), 'data');
    this.quote = opts.quote;
    this.dayPath = join(dataDir, 'day.json');
    this.historyPath = join(dataDir, 'dayHistory.json');
    this.journal = new TradeJournal(dataDir);
    this.day = this.loadDay() ?? freshDay(etToday());
    this.history = this.loadHistory();
    this.rollDay(); // a stale day.json from yesterday rolls immediately
  }

  /** Evaluate a raw alert string (reactive path — parses, then scores). */
  async evaluate(alertText: string, ctx: MarketContext, opts: EvaluateOpts = {}): Promise<EvaluationResult> {
    const raw = makeRawAlert(alertText, opts.source);
    storeRawAlert(raw);
    const idea = await parseAlert(raw);
    return this.runIdea(idea, ctx, opts);
  }

  /** Evaluate a pre-structured idea (proactive path — the scanner builds these). */
  async evaluateIdea(idea: TradeIdea, ctx: MarketContext, opts: EvaluateOpts = {}): Promise<EvaluationResult> {
    return this.runIdea(idea, ctx, opts);
  }

  private async runIdea(idea: TradeIdea, ctx: MarketContext, opts: EvaluateOpts): Promise<EvaluationResult> {
    this.rollDay();
    const factors = await scoreAll(idea, ctx);
    const decision = governDecision(idea, factors, { dayType: ctx.dayType, etMin: etMinutes() });

    // Chase guard: re-quote the underlying NOW — scoring takes real time, and a
    // breakout that already left the entry zone is a different (worse) trade.
    const now = Date.now();
    let currentPrice: number | undefined;
    if (this.quote) {
      try { currentPrice = (await this.quote(idea.ticker)).price; } catch { /* quote miss — guard skips */ }
    }
    let fw = runFirewall(idea, decision, this.day, now, currentPrice);

    // Re-base the fill premium to the re-quoted underlying so paper fills don't
    // book at stale scan-time marks (drift within the chase buffer still costs).
    let liveIdea = idea;
    if (fw.approved && currentPrice != null && idea.entry != null && idea.premium != null) {
      const horizon = idea.timeframe ?? 'intraday';
      const move = Math.abs(currentPrice - idea.entry);
      const favorable = idea.direction === 'long' ? currentPrice >= idea.entry : currentPrice <= idea.entry;
      liveIdea = { ...idea, premium: premiumAt(idea.premium, estDelta(horizon), move, horizon, favorable) };
    }

    // Duplicate suppression — the same move must not re-fire every scan tick.
    const wouldFire = fw.approved
      && (decision.grade === 'A+' || (decision.grade === 'A' && idea.tier !== 'extended'));
    if (wouldFire) {
      const dup = this.registry.considerFire(idea.ticker, idea.setup, idea.direction, decision.grade, now);
      if (dup) fw = { ...fw, approved: false, blocks: [...fw.blocks, dup] };
    } else if (fw.approved && decision.grade === 'B') {
      const dupW = this.registry.considerWatch(idea.ticker, idea.setup, idea.direction, now);
      if (dupW) fw = { ...fw, approved: false, blocks: [...fw.blocks, dupW] };
    }

    const alert = buildAlert(liveIdea, decision, fw, ctx);

    let broker: BrokerResult | null = null;
    // A real FIRE (a paper position) is only A+ / A-on-Core-or-Focus — matches the
    // dispatch routing. B is approved-but-watch-only: it renders a watch alert but does
    // NOT open a paper position or consume a correlation-heat slot.
    const fires = fw.approved
      && (decision.grade === 'A+' || (decision.grade === 'A' && alert.tier !== 'extended'));
    if (fires) {
      broker = await selectBroker(opts.unlock ?? false, claimsAllowed(this.journal.expectancy()))
        .place(toOrder(liveIdea, fw));
      if (broker.accepted) {
        const heatKey = `${clusterOf(idea.ticker)}:${idea.direction}`;
        // Aggregate exposure charges what a stop-out costs (haircutted), matching
        // the firewall's open_risk_cap — symmetric with the release in closeTrade.
        const atStop = riskAtStopUsd(
          broker.fillPremium ?? liveIdea.premium ?? 0,
          alert.exitPlan.stop.premium,
          fw.positionContracts,
          broker.costPaidUsd ?? 0,
        );
        this.day = {
          ...this.day,
          tradesToday: this.day.tradesToday + 1,
          openClusters: { ...this.day.openClusters, [heatKey]: (this.day.openClusters[heatKey] ?? 0) + 1 },
          openPositionsCount: (this.day.openPositionsCount ?? 0) + 1,
          openRiskUsd: Math.round(((this.day.openRiskUsd ?? 0) + atStop) * 100) / 100,
        };
        this.registry.markOpen(idea.ticker, idea.direction);
      }
    }

    const journalEntry = this.journal.record(liveIdea, decision, fw, alert, broker);
    this.persistDay();
    return { idea: liveIdea, decision, firewall: fw, alert, broker, journalEntry };
  }

  /** Current per-day risk state (for the runner / tests / dashboard). */
  dayState(): DayState { return this.day; }

  /** Finished-day summaries (weekly breaker context, dashboard). */
  dayHistory(): readonly DaySummary[] { return this.history; }

  /** Close a MODELED paper trade: books P&L to the day (drives cooldown + daily-loss
   *  + profit lock), frees the correlation-cluster slot and aggregate-risk budget,
   *  applies a name-level cooldown on a loss, and records the closed trade for
   *  expectancy. Driven by the exit monitor / backtest — all fills MODELED. */
  closeTrade(args: {
    ticker: string; direction: 'long' | 'short'; setup: string; tier: Tier;
    entryTimeEt: string; exitTimeEt: string;
    fillPremium: number; exitPremium: number; contracts: number; costPaidUsd: number; stopPremium: number;
    regime: 'up' | 'down' | 'flat'; now?: number;
  }): ClosedTrade {
    const ct = this.journal.closeTrade(args);
    const now = args.now ?? Date.now();
    this.day = recordTradeResult(this.day, ct.pnlUsd, now);
    const heatKey = `${clusterOf(args.ticker)}:${args.direction}`;
    const open = Math.max(0, (this.day.openClusters[heatKey] ?? 1) - 1);
    const atStop = riskAtStopUsd(args.fillPremium, args.stopPremium, args.contracts, args.costPaidUsd);
    this.day = {
      ...this.day,
      openClusters: { ...this.day.openClusters, [heatKey]: open },
      openPositionsCount: Math.max(0, (this.day.openPositionsCount ?? 1) - 1),
      openRiskUsd: Math.max(0, Math.round(((this.day.openRiskUsd ?? 0) - atStop) * 100) / 100),
    };
    if (ct.result === 'loss') {
      const until = now + config.risk.nameCooldownMinutes * 60_000;
      this.day = { ...this.day, cooldownByTicker: { ...this.day.cooldownByTicker, [args.ticker]: until } };
    }
    this.registry.markClosed(args.ticker, args.direction);
    this.persistDay();
    return ct;
  }

  /** Rebuild aggregate-exposure state from the persisted open positions — the
   *  positions file is the source of truth after a restart. */
  syncOpenPositions(positions: readonly OpenPosition[]): void {
    const clusters: Record<string, number> = {};
    let risk = 0;
    for (const p of positions) {
      const key = `${clusterOf(p.ticker)}:${p.direction}`;
      clusters[key] = (clusters[key] ?? 0) + 1;
      risk += riskAtStopUsd(p.fillPremium ?? 0, p.stopPremium ?? 0, p.contracts ?? 1, p.costPaidUsd ?? 0);
      this.registry.markOpen(p.ticker, p.direction);
    }
    this.day = {
      ...this.day,
      openClusters: clusters,
      openPositionsCount: positions.length,
      openRiskUsd: Math.round(risk * 100) / 100,
    };
    this.persistDay();
  }

  /** Roll to a fresh trading day when the ET date changes: archive the finished
   *  day, then apply the multi-day brakes (weekly breaker, red-streak half-size). */
  rollDay(now = new Date()): void {
    const today = etToday(now);
    if (this.day.date === today) return;

    this.history.push({ date: this.day.date, realizedPnlUsd: this.day.realizedPnlUsd, trades: this.day.tradesToday });
    this.history = this.history.slice(-30);
    this.persistHistory();

    // Weekly breaker: rolling 5-day realized loss beyond the cap → stand down today.
    const last5 = this.history.slice(-5).reduce((s, d) => s + d.realizedPnlUsd, 0);
    const weeklyCap = (config.risk.weeklyBreakerLossPct / 100) * config.risk.accountSizeUsd;
    const standDownReason = last5 <= -weeklyCap
      ? `weekly breaker: ${Math.round(last5)} over the last 5 sessions (cap -$${Math.round(weeklyCap)})`
      : null;

    // Red streak: N consecutive losing days → half-size until a green day.
    const streakN = config.risk.redStreakHalfSizeDays;
    const lastN = this.history.slice(-streakN);
    const redStreak = lastN.length >= streakN && lastN.every((d) => d.realizedPnlUsd < 0);

    // Open positions (swing holds) carry across the roll — the exposure is real.
    this.day = {
      ...freshDay(today),
      openClusters: this.day.openClusters,
      openPositionsCount: this.day.openPositionsCount,
      openRiskUsd: this.day.openRiskUsd,
      sizeMultiplier: redStreak ? 0.5 : 1,
      standDownReason,
    };
    this.persistDay();
  }

  /** Attach Josh's discretionary read to the latest journal entry. */
  annotate(joshNote: string): void {
    this.journal.annotate(joshNote);
  }

  // --- persistence (best-effort — a disk hiccup never kills the engine) ----------

  private loadDay(): DayState | null {
    if (!existsSync(this.dayPath)) return null;
    try {
      const d = JSON.parse(readFileSync(this.dayPath, 'utf8')) as DayState;
      return { ...freshDay(d.date), ...d }; // defaults for fields added since the file was written
    } catch { return null; }
  }

  private loadHistory(): DaySummary[] {
    if (!existsSync(this.historyPath)) return [];
    try {
      const h = JSON.parse(readFileSync(this.historyPath, 'utf8')) as DaySummary[];
      return Array.isArray(h) ? h : [];
    } catch { return []; }
  }

  private persistDay(): void {
    try {
      mkdirSync(join(this.dayPath, '..'), { recursive: true });
      writeFileSync(this.dayPath, JSON.stringify(this.day, null, 2), 'utf8');
    } catch { /* best-effort */ }
  }

  private persistHistory(): void {
    try {
      mkdirSync(join(this.historyPath, '..'), { recursive: true });
      writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf8');
    } catch { /* best-effort */ }
  }
}
