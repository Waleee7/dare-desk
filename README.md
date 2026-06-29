# PremiumFloor — Options Trading Decision Engine

An explainable, paper-first decision engine that scores a base bot's options
alerts through six independent lenses, enforces hard risk discipline, and emits
clean PremiumFloor alerts — with an optional path to autonomous execution via
**Robinhood Agentic Trading (MCP)**.

> ⚠️ Not financial advice. Live trading is **off by default**. Everything runs in
> paper/shadow mode until proven and explicitly unlocked.

## Quickstart

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY for LLM scoring
npm run demo              # runs the full hackathon walkthrough (works offline)
npm run typecheck
npm start -- "SPY 580C 6/20 unusual flow, entry 578 stop 576 targets 582 585"
```

No API key? The six scorers fall back to deterministic heuristics — the pipeline,
demo, and tests all still run.

## How it works

`ingest → parse → score(6) → govern → firewall → alert → broker(paper) → journal`

- **Scoring (6 lenses, weighted to 100):** technical 25 · regime 20 · news 15 · options-chain 15 · risk/reward 15 · Josh-lens 10.
- **Governor:** A+ ≥ 85 · ALERT 75–84 · WATCH 65–74 · REJECT < 65 (no-trade is final).
- **Firewall hard blocks:** no stop · wide spread · R:R < 1.5 · weak regime · event-risk · overtrading · max daily loss · cooldown · single-factor confidence. Risk-based position sizing.
- **Output:** PremiumFloor alert (or a "BOT PASSED" card explaining the block).
- **Execution:** `PaperBroker` (default). `RobinhoodAgentMcpBroker` documents the MCP-client path and stays disabled until `LIVE_TRADING=true` + explicit unlock.
- **Journal:** every alert/skip/fill with mistake tags + rule-improvement ideas.

See `ARCHITECTURE.md` for the full plan and `.claude/skills/` for the design rubrics each component implements.

## Structure

```
src/
  lib/        types, config, llm helper (structured outputs + caching)
  ingest/     alert parsing + raw store
  scoring/    the six lenses + orchestrator
  engine/     governor + risk firewall
  discord/    PremiumFloor alert formatter
  broker/     adapter interface, PaperBroker, RobinhoodAgentMcpBroker
  journal/    trade journal memory
  backtest/   backtest/shadow mode scaffold (anti-lookahead contract)
  pipeline.ts / demo.ts / index.ts
```

## Safety model

Paper-first · risk firewall before any order · live disabled by default ·
human-in-the-loop approval before autonomous execution · journal before & after
every trade · no profitability claims without ≥100 validated paper/shadow trades.
