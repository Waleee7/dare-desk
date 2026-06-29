#!/usr/bin/env bash
set -e

mkdir -p .claude/skills

create_skill () {
  name="$1"
  body="$2"
  mkdir -p ".claude/skills/$name"
  cat > ".claude/skills/$name/SKILL.md" <<SKILL
$body
SKILL
}

create_skill "trading-signal-forensics" '---
name: trading-signal-forensics
description: Analyze historical Discord/Schwab/options alerts to reverse-engineer what worked, what failed, what was missed, and what rules should improve the trading bot. Use when reviewing alerts, screenshots, exported messages, trade logs, or bot performance.
---

# Trading Signal Forensics

## Mission
Turn raw alerts and trade history into structured evidence. Never assume the bot is good because it sounds confident. Grade every signal like a trading detective.

## Workflow
1. Parse every alert into structured JSON.
2. Label the alert.
3. Identify the reason.
4. Output what to improve.

## Safety
Do not declare a strategy profitable from a small sample.
'

create_skill "josh-trader-lens" '---
name: josh-trader-lens
description: Convert Josh discretionary options trading instincts into structured bot rules. Use when Josh says he sees a setup, wants the bot to catch a missed play, or wants the bot to trade more like his personal style.
---

# Josh Trader Lens

## Mission
Translate Josh experienced trader eye into repeatable rules without letting emotion override risk.

## Safety
Josh override cannot bypass max loss, contract liquidity, news blackout, or market-regime rejection.
'

create_skill "market-regime-sentinel" '---
name: market-regime-sentinel
description: Score overall market conditions before allowing options alerts. Use when the bot evaluates SPY, QQQ, indexes, VIX, yields, breadth, economic events, fear/greed, or whether today is call-friendly, put-friendly, choppy, or no-trade.
---

# Market Regime Sentinel

## Mission
Prevent good-looking setups from firing during hostile market conditions.
'

create_skill "news-catalyst-radar" '---
name: news-catalyst-radar
description: Add news, macro, earnings, Fed, analyst, and sector catalyst checks to trading bot decisions. Use when a trade may be affected by headlines, earnings, economic events, breaking news, or unusual sector movement.
---

# News Catalyst Radar

## Mission
Make the bot aware of the outside world before it fires a signal.
'

create_skill "options-chain-sniper" '---
name: options-chain-sniper
description: Evaluate options contracts for liquidity, spread, delta, expiration, IV, open interest, volume, risk/reward, and execution quality. Use before choosing or approving any options contract.
---

# Options Chain Sniper

## Mission
A good stock setup with a trash option contract is still a bad trade.
'

create_skill "risk-discipline-firewall" '---
name: risk-discipline-firewall
description: Enforce strict risk rules before any alert, paper trade, or broker-ready order. Use whenever a trade idea is being scored, approved, rejected, sized, or sent to Discord.
---

# Risk Discipline Firewall

## Mission
Protect the trader from bad conditions, emotional trades, overtrading, and bot overconfidence.
'

create_skill "missed-trade-learning-lab" '---
name: missed-trade-learning-lab
description: Convert missed winning trades into structured learning records so the bot can improve future rules. Use whenever Josh says the bot missed a setup, stayed silent, or should have alerted.
---

# Missed Trade Learning Lab

## Mission
Every missed trade becomes a lesson, not a complaint.
'

create_skill "discord-alert-copilot" '---
name: discord-alert-copilot
description: Create clean PremiumFloor-style Discord alerts for options trades with setup, contract, entry, stop, targets, confidence, reasoning, and risk notes. Use when producing Discord bot alert messages.
---

# Discord Alert Copilot

## Mission
Make alerts clean, fast, explainable, and premium-looking.
'

create_skill "broker-adapter-architect" '---
name: broker-adapter-architect
description: Design broker adapter architecture for trading bots, including Schwab, Alpaca, Tradier, Robinhood agentic MCP, paper trading, manual approval, and safe execution boundaries. Use when planning broker integrations or order execution.
---

# Broker Adapter Architect

## Mission
Keep the trading bot broker-flexible and safe.

## Safety Rules
Default to paper trading. Live trading disabled by default. Manual approval required before real orders.
'

create_skill "backtest-and-shadow-mode" '---
name: backtest-and-shadow-mode
description: Build and evaluate backtesting, shadow mode, paper trading, walk-forward testing, slippage modeling, and performance metrics for the trading bot. Use when testing whether a strategy is real or just lucky.
---

# Backtest and Shadow Mode

## Mission
Prove the bot has edge before risking real money.
'

create_skill "trade-journal-memory" '---
name: trade-journal-memory
description: Create structured trade journal records and learning feedback loops for alerts, paper trades, missed trades, wins, losses, and rule improvements. Use after any alert, trade result, review, or end-of-day recap.
---

# Trade Journal Memory

## Mission
Make the bot learn from every alert and every skipped trade.
'

create_skill "hackathon-demo-director" '---
name: hackathon-demo-director
description: Shape the trading bot into a strong hackathon presentation with demo flow, product story, judging impact, UI narrative, safety framing, and technical architecture. Use when preparing the pitch, README, slides, demo script, or final presentation.
---

# Hackathon Demo Director

## Mission
Make the trading bot look like a real product, not a random script.
'

create_skill "profitability-reality-check" '---
name: profitability-reality-check
description: Prevent unrealistic claims about win rate, profitability, or guaranteed trading performance. Use whenever the user wants high profitability, backtest claims, signal accuracy, or trading performance metrics.
---

# Profitability Reality Check

## Mission
Keep the bot honest. Do not allow fake claims like guaranteed profit or risk-free trading.
'

create_skill "strategy-edge-governor" '---
name: strategy-edge-governor
description: Manage trading strategy rules, edge hypotheses, confluence scoring, confidence caps, no-trade rules, and rule promotion from experiment to production. Use when deciding whether a setup deserves bot alerts.
---

# Strategy Edge Governor

## Mission
Only promote strategies that show repeatable edge.
'

echo "Trading skills created in .claude/skills"
