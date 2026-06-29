// The pipeline — wires all components into one decision flow:
// ingest → parse → score(6) → govern → firewall → alert → broker → journal.

import type { MarketContext, TradeIdea, GovernorDecision, FirewallResult, PremiumFloorAlert, BrokerResult } from './lib/types.js';
import { makeRawAlert, storeRawAlert } from './ingest/store.js';
import { parseAlert } from './ingest/parseAlert.js';
import { scoreAll } from './scoring/index.js';
import { governDecision } from './engine/governor.js';
import { runFirewall, freshDay } from './engine/firewall.js';
import { buildAlert } from './discord/alert.js';
import { selectBroker, toOrder } from './broker/index.js';
import { TradeJournal, type JournalEntry } from './journal/journal.js';

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
    if (firewall.approved) {
      broker = await selectBroker(opts.unlock ?? false).place(toOrder(idea, firewall));
      // Count it against the daily trade budget (drives the overtrading firewall).
      this.day = { ...this.day, tradesToday: this.day.tradesToday + 1 };
    }

    const journalEntry = this.journal.record(idea, decision, firewall, alert, broker);
    return { idea, decision, firewall, alert, broker, journalEntry };
  }

  /** Attach Josh's discretionary read to the latest journal entry. */
  annotate(joshNote: string): void {
    this.journal.annotate(joshNote);
  }
}
