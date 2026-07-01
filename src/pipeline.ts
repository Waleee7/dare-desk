// The pipeline — wires all components into one decision flow:
// ingest → parse → score(6) → govern → firewall → alert → broker → journal.

import type { MarketContext, TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, BrokerResult, ClosedTrade, Tier, DayState } from './lib/types.js';
import { makeRawAlert, storeRawAlert } from './ingest/store.js';
import { parseAlert } from './ingest/parseAlert.js';
import { scoreAll } from './scoring/index.js';
import { governDecision } from './engine/governor.js';
import { runFirewall, freshDay, recordTradeResult } from './engine/firewall.js';
import { buildAlert } from './discord/alert.js';
import { selectBroker, toOrder } from './broker/index.js';
import { TradeJournal, type JournalEntry } from './journal/journal.js';
import { config, clusterOf } from './lib/config.js';

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
  /** Explicit live-broker unlock (still requires LIVE_TRADING=true). Default false. */
  unlock?: boolean;
}

export class PremiumFloorEngine {
  readonly journal = new TradeJournal();
  private day = freshDay();

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
    const factors = await scoreAll(idea, ctx);
    const decision = governDecision(idea, factors);
    const firewall = runFirewall(idea, decision, this.day);
    const alert = buildAlert(idea, decision, firewall, ctx);

    let broker: BrokerResult | null = null;
    // A real FIRE (a paper position) is only A+ / A-on-Core-or-Focus — matches the
    // dispatch routing. B is approved-but-watch-only: it renders a watch alert but does
    // NOT open a paper position or consume a correlation-heat slot (watches never close,
    // so counting them would let heat accumulate forever in the continuous runner).
    const fires = firewall.approved
      && (decision.grade === 'A+' || (decision.grade === 'A' && alert.tier !== 'extended'));
    if (fires) {
      broker = await selectBroker(opts.unlock ?? false).place(toOrder(idea, firewall));
      const heatKey = `${clusterOf(idea.ticker)}:${idea.direction}`;
      this.day = {
        ...this.day,
        tradesToday: this.day.tradesToday + 1,
        openClusters: { ...this.day.openClusters, [heatKey]: (this.day.openClusters[heatKey] ?? 0) + 1 },
      };
    }

    const journalEntry = this.journal.record(idea, decision, firewall, alert, broker);
    return { idea, decision, firewall, alert, broker, journalEntry };
  }

  /** Current per-day risk state (for the runner / tests / dashboard). */
  dayState(): DayState { return this.day; }

  /** Close a MODELED paper trade: books P&L to the day (drives cooldown + daily-loss),
   *  frees the correlation-cluster slot, applies a name-level cooldown on a loss, and
   *  records the closed trade for expectancy. Driven by an exit monitor / backtest —
   *  all fills MODELED (no live chain). This is what makes expectancy actually move. */
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
    this.day = { ...this.day, openClusters: { ...this.day.openClusters, [heatKey]: open } };
    if (ct.result === 'loss') {
      const until = now + config.risk.nameCooldownMinutes * 60_000;
      this.day = { ...this.day, cooldownByTicker: { ...this.day.cooldownByTicker, [args.ticker]: until } };
    }
    return ct;
  }

  /** Attach Josh's discretionary read to the latest journal entry. */
  annotate(joshNote: string): void {
    this.journal.annotate(joshNote);
  }
}
