---
name: josh-trader-lens
description: Learn and apply Josh's personal QQQ/SPY options scalping style. Use whenever the bot evaluates a potential trade, Josh says he sees a setup, wants a missed play caught, or wants the bot to trade more like him. This is the primary pattern-recognition lens — it decides "is this one of Josh's plays?" before any grading happens.
---

# Josh Trader Lens

## Mission
Translate Josh's discretionary QQQ/SPY options eye into repeatable, explainable rules — without letting emotion or FOMO override risk. This lens names the pattern; it does not size, grade, or fire.

## Style DNA (defaults — refined by setup-dna-extractor)
- **Instruments — 3 tiers (see signal-grade-judge for the bar):**
  - **Core:** QQQ, SPY.
  - **Focus:** Mag7 (AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA) + semiconductors (AMD, AVGO, MU, SMH, SOXL, etc).
  - **Extended (any other stock):** allowed ONLY at a 90%+ signal score. The edge is Core + Focus; everything else must be exceptional.
- **Trade type:** quick puts/calls, **5–30 min holds**, scalps. Not swings.
- **Read:** price action + VWAP + liquidity sweeps + trend breaks + rejection levels + market sentiment + news + options flow.
- **Bias source:** market-regime-brain sets the day's tilt (call-friendly / put-friendly / no-trade) BEFORE this lens fires.

## The 9 core plays this lens detects
1. **VWAP reclaim / reject** — price reclaims VWAP with momentum (call) or rejects from below (put).
2. **Liquidity sweep** — stop-run beyond a prior high/low, then snap-back reversal.
3. **Fake breakout (fakeout)** — break of level that fails and reverses; fade it.
4. **Breakdown continuation** — clean break of support, retest-and-fail, continuation down (put).
5. **Trendline break** — break of an established intraday trendline with volume.
6. **Opening range break (ORB)** — break of the first 5–15 min range with confirmation.
7. **Supply/demand reaction** — sharp reaction off a marked S/D zone or key daily level.
8. **Reversal scalp** — exhaustion + rejection candle at an extreme; counter-trend, tight stop.
9. **Momentum continuation** — pullback-and-go inside an established intraday trend.

## The 7 questions (answer ALL, every setup)
1. Does this look like one of Josh's setups? (name it, or NO-TRADE)
2. What exact pattern is forming? (one of the 9, with the trigger candle/level)
3. Are QQQ/SPY and the broader market aligned? (regime + index correlation)
4. Is the contract clean enough to trade? (defer to options-contract-killer)
5. What could make this fail? (the invalidation — be specific)
6. Is this an alert, watch-only, or no-trade?
7. What should the Discord message say? (hand to entry-exit-architect)

## Output (structured)
`{ isJoshSetup: bool, pattern: <one of 9|null>, direction: call|put, timeframeSeen, triggerLevel, alignmentWithMarket, invalidation, lensConfidence: 0-100, verdict: alert|watch|no-trade }`

## Wires to (code)
`src/scan/setups.ts` (pattern detection), `src/scan/scanner.ts` (orchestration), `src/scan/indicators.ts` (VWAP/levels). Feeds mtf-sniper-engine and signal-grade-judge.

## Pipeline position
market-regime-brain → **josh-trader-lens** → mtf-sniper-engine → whale-flow-decoder → news-catalyst-radar → options-contract-killer → signal-grade-judge → entry-exit-architect → risk-discipline-commander.

## Safety
Josh's read cannot bypass risk-discipline-commander, options-contract-killer, news blackout, or a market-regime-brain no-trade day. A named pattern is necessary but never sufficient — it must survive the full pipeline.
