// Component 6 — broker adapters, decoupled from strategy. Paper is the default
// and only enabled broker; live is OFF unless explicitly unlocked. Robinhood
// agentic execution is MCP-based — the adapter documents that path but stays
// hard-disabled until paper-proven and unlocked.

import type { BrokerOrder, BrokerResult, BrokerMode, FirewallResult, TradeIdea } from '../lib/types.js';
import { config } from '../lib/config.js';

export interface BrokerAdapter {
  readonly mode: BrokerMode;
  place(order: BrokerOrder): Promise<BrokerResult>;
}

/** Build a normalized order from an approved idea + firewall sizing. */
export function toOrder(idea: TradeIdea, fw: FirewallResult): BrokerOrder {
  return {
    ideaId: idea.alertId,
    ticker: idea.ticker,
    optionType: idea.contract.optionType,
    strike: idea.contract.strike,
    expiry: idea.contract.expiry,
    contracts: fw.positionContracts,
    limitPremium: idea.premium,
    stop: fw.stop,
    targets: fw.targets,
    maxLossUsd: fw.maxLossUsd,
  };
}

/** Default broker — simulates fills, never touches money. */
export class PaperBroker implements BrokerAdapter {
  readonly mode: BrokerMode = 'paper';
  async place(order: BrokerOrder): Promise<BrokerResult> {
    if (order.contracts <= 0) {
      return { accepted: false, mode: this.mode, message: 'Zero-size order (sizing produced 0 contracts).' };
    }
    return {
      accepted: true,
      mode: this.mode,
      orderId: `paper-${order.ideaId}`,
      message: `PAPER fill: ${order.contracts}x ${order.ticker} ${order.strike}${order.optionType[0]!.toUpperCase()} @ ${order.limitPremium ?? 'mkt'} (max risk $${order.maxLossUsd}).`,
    };
  }
}

/**
 * Robinhood Agentic Trading via MCP (`agent.robinhood.com/mcp/trading`).
 * The official product is MCP-based and Claude Code is a supported client.
 * An app connects as an MCP client through the Anthropic MCP-client beta:
 *
 *   await anthropic.beta.messages.create({
 *     model: 'claude-opus-4-8',
 *     max_tokens: 2048,
 *     betas: ['mcp-client-2025-11-20'],
 *     mcp_servers: [{ type: 'url', name: 'robinhood', url: config.robinhoodMcpUrl }],
 *     messages: [{ role: 'user', content: 'Place a limit order: ...' }],
 *   });
 *
 * Real execution requires the user's Robinhood OAuth on a dedicated Agentic
 * account (write-scoped) and approval-mode confirmation. Options agentic exec is
 * still rolling out at RH (equities are live). DISABLED until LIVE_TRADING=true
 * AND an explicit per-run unlock — by default this refuses.
 */
export class RobinhoodAgentMcpBroker implements BrokerAdapter {
  readonly mode: BrokerMode = 'approval';
  constructor(private readonly unlocked: boolean) {}
  async place(order: BrokerOrder): Promise<BrokerResult> {
    if (!config.liveTrading || !this.unlocked) {
      return {
        accepted: false,
        mode: this.mode,
        message: `LIVE DISABLED — order staged for Robinhood MCP approval but not sent. `
          + `Set LIVE_TRADING=true + pass an explicit unlock, link a RH Agentic account (OAuth), `
          + `and confirm options agentic exec is enabled on the account. Order: `
          + `${order.contracts}x ${order.ticker} ${order.strike}${order.optionType[0]!.toUpperCase()}.`,
      };
    }
    // Phase 3: MCP-client call to config.robinhoodMcpUrl in approval mode.
    return { accepted: false, mode: this.mode, message: 'RH MCP execution not implemented in this build (Phase 3).' };
  }
}

/** Pick the broker. Always paper unless live is explicitly enabled AND unlocked. */
export function selectBroker(unlock = false): BrokerAdapter {
  if (config.liveTrading && unlock) return new RobinhoodAgentMcpBroker(unlock);
  return new PaperBroker();
}
