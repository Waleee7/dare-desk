---
name: setup-dna-extractor
description: Convert every winning, losing, or missed trade — plus screenshots, chat logs, and examples Josh provides — into repeatable, structured rules that sharpen josh-trader-lens and signal-grade-judge over time. Use when Josh shares an example trade, a screenshot, a missed play, an exported log, or after any trade result. This is the learning loop.
---

# Setup DNA Extractor

## Mission
Turn raw trading evidence into structured, testable rules. Every trade — good, bad, or missed — becomes DNA the bot can reuse. No lesson stays as a vibe.

## Inputs it accepts
- Screenshots of charts / option chains / P&L.
- Discord / Schwab / broker logs and exported messages.
- Josh describing a play in plain language ("I longed QQV off the VWAP reclaim").
- Missed setups the bot stayed silent on (see redirect: `missed-trade-learning-lab`).
- Historical alert review (see redirect: `trading-signal-forensics`).

## The 6 DNA fields (extract for EVERY example)
1. **Entry trigger** — the exact event that starts the trade (candle close, level break, sweep-and-reclaim).
2. **Timeframe confirmation** — which TFs must agree (ties to mtf-sniper-engine).
3. **Invalidation** — the precise price/condition that means "wrong, get out."
4. **Contract choice** — strike offset, DTE, delta band, why (ties to options-contract-killer).
5. **Market condition** — the regime this works in / fails in (ties to market-regime-brain).
6. **Exit logic** — targets, trail, time-stop (ties to entry-exit-architect).

## Workflow
1. Parse the example into structured JSON (which of the 9 josh-trader-lens plays?).
2. Label outcome: win / loss / scratch / missed.
3. Extract the 6 DNA fields.
4. Diff against existing rules — does this confirm, refine, or contradict a rule?
5. Emit a **rule proposal** (new or amended) → routed to signal-grade-judge for promotion.
6. Log it to the journal with a post-trade lesson.

## Output (structured)
`{ play, outcome, dna: {entryTrigger, tfConfirmation, invalidation, contractChoice, marketCondition, exitLogic}, ruleProposal: {status: new|amend|contradict, text}, lesson }`

## Track expectancy (not just win-rate)
Per setup type, compute **expectancy = (winRate × avgWin) − (lossRate × avgLoss)** in R multiples. A 45%-win setup with 2R winners beats a 60%-win setup with 1R winners. Promote setups by expectancy; retire negative-expectancy plays even if they "feel" right.

## Rule promotion gate
A proposed rule is a **hypothesis** until it clears sample size. Do NOT promote from n=1. Promotion criteria and confidence caps are owned by signal-grade-judge; DNA extractor only proposes.

## Wires to (code)
`src/journal/journal.ts`, `src/backtest/index.ts`. Absorbs the intent of `missed-trade-learning-lab` and `trading-signal-forensics`.

## Pipeline position
Runs OUTSIDE the live signal path as the continuous learning loop. Feeds josh-trader-lens (better pattern rules) and signal-grade-judge (calibrated grades).

## Safety
Never declare a strategy profitable from a small sample. A single winning example is not an edge. Respect profitability-reality-check.
