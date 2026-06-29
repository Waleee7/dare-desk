# PremiumFloor — Options Trading Decision Engine

A hackathon-grade, explainable decision engine that takes a base trading bot's
Discord/Schwab alerts, scores them through six independent lenses, enforces hard
risk discipline, and emits clean PremiumFloor alerts — paper-first, with an
optional path to autonomous execution through **Robinhood Agentic Trading (MCP)**.

> Not financial advice. The athlete's discretionary edge is the IP. Live trading
> is disabled by default; everything runs in paper/shadow mode until explicitly
> enabled, proven, and re-enabled per session.

---

## Stack

- **TypeScript / Node 24** — matches the existing ecosystem (Echo, ThrowingTracker), lighter than a Python data stack on 8 GB RAM, and has first-class MCP-client + Anthropic SDK support.
- **`@anthropic-ai/sdk`** — LLM scoring via `messages.parse()` (Zod structured outputs) + adaptive thinking + prompt caching.
- **`zod`** — schema validation for every LLM score (no free-text parsing).
- **`discord.js`** *(adapter, later)* — signal output. v1 prints the formatted alert; the Discord transport is a thin sink.
- **Robinhood Agentic Trading MCP** — execution. The official product is MCP-based (`https://agent.robinhood.com/mcp/trading`); Claude Code is a supported client. We connect via the Anthropic MCP-client beta. **Options agentic exec is still rolling out at RH; equities are live.**

## Data flow (the pipeline)

```
Discord/Schwab alert (raw text)
        │
        ▼  ingest/parseAlert.ts  (LLM → structured TradeIdea)
   TradeIdea ───────────────────────────────────────────────┐
        │                                                    │
        ▼  scoring/index.ts  (6 independent lenses, 0–100)   │ MarketContext
   ┌─ technical (25) ─ joshLens (10) ─ regime (20) ──────────┤ (regime, news,
   ├─ news (15) ─ optionsChain (15) ─ riskReward (15) ───────┤  chain, account,
   └────────────────────────────────────────────────────────┘  day-state)
        │
        ▼  engine/governor.ts  (Strategy Edge Governor → /100 + decision)
   GovernorDecision  { total, grade: A_PLUS|ALERT|WATCH|REJECT, breakdown }
        │
        ▼  engine/firewall.ts  (Risk Discipline Firewall — hard blocks + sizing)
   FirewallResult  { approved, blocks[], positionSize, stop, targets }
        │
        ├──▶ discord/alert.ts   → PremiumFloor alert (or "BOT PASSED" card)
        ├──▶ broker/            → PaperBroker (default) | RobinhoodAgentMcpBroker (live-gated)
        └──▶ journal/           → every alert/skip/fill/result, with mistake tags + rule ideas
```

## The nine components (→ files)

| # | Component | Skill | File(s) |
|---|---|---|---|
| 1 | Discord alert ingestion | trading-signal-forensics | `src/ingest/parseAlert.ts`, `src/ingest/store.ts` |
| 2 | Signal scoring engine (6 lenses) | technical / josh-trader-lens / market-regime-sentinel / news-catalyst-radar / options-chain-sniper | `src/scoring/index.ts` |
| 3 | Strategy Edge Governor (/100, A+/watch/reject) | strategy-edge-governor | `src/engine/governor.ts` |
| 4 | Risk Discipline Firewall (hard blocks, sizing, daily loss, cooldown) | risk-discipline-firewall | `src/engine/firewall.ts` |
| 5 | Discord Alert Copilot (PremiumFloor format) | discord-alert-copilot | `src/discord/alert.ts` |
| 6 | Paper trading mode (broker adapters separated, live OFF) | broker-adapter-architect | `src/broker/index.ts` |
| 7 | Trade Journal Memory | trade-journal-memory | `src/journal/journal.ts` |
| 8 | Backtest & Shadow mode | backtest-and-shadow-mode | `src/backtest/` *(scaffold)* |
| 9 | Hackathon Demo Mode | hackathon-demo-director | `src/demo.ts` |

## Scoring & governance (deterministic, per Josh's spec)

**Weights (sum = 100):** technical 25 · regime 20 · news 15 · options-chain 15 · risk/reward 15 · Josh-lens 10.

**Governor grades:** `A_PLUS ≥ 85` · `ALERT 75–84` · `WATCH 65–74` · `REJECT < 65`. A no-trade verdict is final — nothing downstream can override it.

**Confidence ceilings (Josh-lens skill):** technicals-only ≤ 7/10 · +regime ≤ 8 · +regime +news +chain ≤ 9. Single-factor confidence is a firewall block.

**Firewall hard blocks:** no clear stop · spread too wide · R:R below threshold (default 1.5) · regime score below floor (default 50) · event-risk/news blackout · overtrading (default max 5/day) · max daily loss hit (default 3%) · active cooldown (default 45 min after 2 consecutive losses) · single-factor confidence.

**Position sizing:** `contracts = floor((account × maxRiskPerTrade%) / (perContractRisk))`, where `perContractRisk = (entry − stop) × 100`. Defaults: 1% risk/trade, 3% daily max loss.

## LLM usage (Anthropic)

- Scorers + parser call `client.messages.parse()` with a **Zod `output_config.format`** — every score is validated structured JSON, never regex'd from prose.
- **Adaptive thinking** (`thinking: { type: "adaptive" }`) + configurable `effort` (default `low` for high-volume per-factor scorers; raise for Josh-lens/regime).
- **Prompt caching**: each scorer's stable rubric is a cached system block (`cache_control: ephemeral`).
- **Model**: `claude-opus-4-8` by default (most capable). Override per-deployment via `SCORER_MODEL` / `PARSER_MODEL` — `claude-sonnet-4-6` or `claude-haiku-4-5` are cheaper for high call volume; that's an explicit operator choice, not a default.
- **Offline-safe**: with no `ANTHROPIC_API_KEY`, scorers fall back to deterministic heuristics so the pipeline, demo, and tests still run.

## Execution & safety

- `BrokerAdapter` interface decouples strategy from execution.
- **`PaperBroker`** (default) simulates fills, tracks P/L, never touches money.
- **`RobinhoodAgentMcpBroker`** connects to `agent.robinhood.com/mcp/trading` via the Anthropic MCP-client beta (`mcp_servers` + `mcp-client-2025-11-20`), in **approval mode** (human-in-the-loop). Hard-gated behind `LIVE_TRADING=true` AND an explicit per-run unlock; **disabled by default**. Options exec depends on RH's rollout reaching the account.
- Every order is journaled before and after; failed broker calls do not blindly retry.

## Roadmap

- **Phase 1 (this scaffold):** pipeline, 6 scorers, governor, firewall, PremiumFloor alert, paper broker, journal, demo. Runs offline.
- **Phase 2:** real market-data + news + Fear&Greed + options-chain providers behind the `MarketContext` interface; Discord bot transport; persistent journal store.
- **Phase 3:** backtest harness with slippage/spread + walk-forward; shadow mode logging; then RH MCP approval-mode execution (equities first), paper-proven before any live unlock.
