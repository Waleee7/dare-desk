---
name: news-catalyst-radar
description: Make the bot aware of the outside world before it fires. Use whenever a trade may be affected by macro data, Fed events, earnings, analyst moves, geopolitics, or unusual sector movement. Adds catalyst bias and news-risk to every signal and enforces blackout windows around scheduled events.
---

# News Catalyst Radar

## Mission
Add catalyst awareness and news-risk to every signal. A perfect chart 90 seconds before CPI is a trap. Know what's scheduled, what just broke, and which way it tilts.

## What it tracks
- **Scheduled macro:** CPI, PPI, jobs/NFP, FOMC/Fed speakers, retail sales, GDP, PCE.
- **Fed:** rate decisions, minutes, Powell/member remarks.
- **Earnings:** for watchlist names and market-movers (before/after bell).
- **Analyst moves:** upgrades/downgrades, price-target changes on watchlist names.
- **Geopolitical / breaking headlines.**
- **Cross-asset tone:** VIX, 10Y yields, dollar, oil, sector rotation.

## Two jobs
1. **Blackout enforcement** — around scheduled high-impact events (e.g. ± a set window around CPI/FOMC), suppress new QQQ/SPY scalps or widen invalidation. Hard-coordinate with risk-discipline-commander.
2. **Catalyst bias** — tag the tape's directional lean and risk level, feed as a confidence modifier (supportive catalyst = small boost; conflicting/uncertain catalyst = penalty).

## Data sources (FREE + live + verified, per Josh)
Use the best free, real-time, verified sources; cross-check, never trust a single feed:
- **Market news (real-time):** Alpaca News API (Benzinga-powered, free, real-time) — primary. Finnhub free tier (company news). Marketaux / Alpha Vantage news-sentiment as backup.
- **Economic calendar:** Finnhub + Financial Modeling Prep (FMP) free tiers (CPI/PPI/NFP/FOMC/GDP/PCE times).
- **Earnings calendar:** Finnhub / FMP free.
- **Macro / cross-asset:** FRED (official, free — yields, rates, dollar); Yahoo/Alpha Vantage for VIX & sector ETFs.
- **Verification:** a headline moves bias only if 2+ sources or an official source confirm it. Unconfirmed = risk flag, not a bias.

## Output (structured)
`{ upcomingEvents: [{event, time, impact}], activeBlackout: bool, catalystBias: bullish|bearish|neutral, newsRisk: low|med|high, notes }`

## Wires to (code)
`src/news/index.ts`, `src/news/alpaca.ts`, `src/news/alphavantage.ts`, news lens in `src/scoring/index.ts`. (Verify live vs mock before trusting in production.)

## Pipeline position
... whale-flow-decoder → **news-catalyst-radar** → options-contract-killer → signal-grade-judge. Blackout also gates risk-discipline-commander.

## Safety
When a high-impact event is imminent and unpriced, default to no-trade or watch. Do not fire scalps into the teeth of scheduled volatility.
