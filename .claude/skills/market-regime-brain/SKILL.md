---
name: market-regime-brain
description: Classify the trading day's regime and set the bot's tilt BEFORE any setup is graded. Use at session start and continuously — reads SPY/QQQ, VIX, yields, breadth, and price structure to decide trend/chop/range/reversal/low-vol-trap/news-driven/bull/bear/power-hour, then adjusts every signal's confidence.
---

# Market Regime Brain

## Mission
Prevent good-looking setups from firing into hostile conditions. Classify the day first; the regime is the multiplier on everything downstream.

## Regimes (classify the current one, can shift intraday)
- **Bull trend** — higher highs/lows, call-friendly, buy dips.
- **Bear trend** — lower highs/lows, put-friendly, sell rips.
- **Trend (directional)** — strong one-way, continuation plays favored.
- **Chop** — overlapping candles, no follow-through → suppress signals hard.
- **Range** — defined highs/lows → fade edges, avoid the middle.
- **Reversal** — trend exhaustion / failed breakout → reversal scalps only, tight stops.
- **Low-volume trap** — thin, drifty, stop-hunt prone → high skepticism.
- **News-driven** — macro/headline tape → widen invalidation or stand down.
- **Power-hour momentum** — last-hour directional push → momentum continuation shines.

## Inputs
SPY & QQQ structure and correlation, VIX level + direction, 10Y yields, dollar, sector breadth, time-of-day (open / mid-day lull / power hour), and the economic calendar (hand-off with news-catalyst-radar).

## Intraday windows (scalp edge is time-dependent)
- **Open 9:30–10:30 ET:** prime — ORB, momentum, sweeps. Highest edge.
- **10:30–11:30:** trend continuation still workable.
- **Lunch 11:30–13:30:** low-volume chop — **suppress hard** (where accounts bleed).
- **13:30–15:00:** re-engagement; watch for the afternoon trend.
- **Power hour 15:00–16:00:** momentum / continuation shine.

## VIX adaptation
- **Low VIX (<~15):** tight ranges, fast theta — tighter targets, shorter holds, closer strikes.
- **Elevated VIX (>~20):** wider swings, richer premium — widen invalidation, respect bigger stops, size down.

## Output (structured)
`{ regime, tilt: call-friendly|put-friendly|neutral|no-trade, confidenceMultiplier: 0.0-1.2, timeWindow, vixState, notes, timeOfDay }`

## How it adjusts signals
- Multiplier **>1.0** only when regime strongly supports the setup direction (e.g. momentum continuation in power-hour trend).
- Multiplier **<1.0** in chop / low-vol-trap / range-middle.
- Multiplier **0 (no-trade)** on hostile or unclear regimes — this is a hard gate, mirrored by risk-discipline-commander.

## Wires to (code)
`src/context/marketContext.ts`, regime lens in `src/scoring/index.ts`. **Supersedes `market-regime-sentinel`.**

## Pipeline position
**market-regime-brain** (FIRST) → josh-trader-lens → ... Everything downstream is scaled by its multiplier.

## Safety
Unclear regime = reduce or stand down, never guess. A no-trade regime overrides even an A+ chart.
