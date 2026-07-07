# DARE Desk

An open, explainable options-trading **decision engine + dashboard** — a framework
for turning market data into disciplined, graded signals with a full audit trail.
Built to be forked: every stage is a small, typed module you can swap or extend.

> ⚠️ **Not financial advice.** Live trading is **off by default**. Everything runs
> in modeled paper mode until a strategy proves itself and is explicitly unlocked.
> All fills are estimates, not live execution.

## What it is

DARE Desk scans a liquid options universe, reads the tape across multiple
timeframes, grades each setup on earned confidence, and only surfaces the ones
that clear a strict discipline bar — then it **manages the exit out loud** and
learns from every closed trade. It ships with a clean, mobile-first dashboard
and a replay backtester so you can validate any change against history before it
goes live.

The whole thing runs offline on deterministic mock data (no keys needed to try
it), and upgrades to real-time when you add a free market-data key.

## Quickstart

```bash
npm install
cp .env.example .env      # optional — runs fully offline with no keys
npm run go                # start the continuous scanner (RUN_OFFHOURS=true to test after hours)
npm run backtest          # replay history through the live pipeline, print an edge report
npm test                  # full test suite
```

Dashboard:

```bash
cd dashboard && npm install && npm run start   # http://localhost:3007
```

With **no keys**, scoring falls back to deterministic heuristics and the feed is
mock — the pipeline, dashboard, backtester, and tests all still run. Add a free
[Alpaca](https://alpaca.markets) key pair for real-time data, an Anthropic key
for LLM scoring, and Discord webhook(s) for alerts.

## Pipeline

```
scan → score → govern → firewall → alert → broker(paper) → exit-monitor → journal
```

- **Scan** — multi-timeframe setup detection (VWAP, breakouts, momentum, gaps,
  liquidity sweeps) with a higher-timeframe trend stack (15m/1h/4h/1D), relative
  volume, and key levels + call/put walls from the delayed options chain.
- **Score** — six independent lenses (technical, regime, news, options-chain,
  risk/reward, discretionary), each LLM-scored with a cached rubric and a
  deterministic heuristic fallback.
- **Govern** — weights the lenses into an **earned confidence** that can't exceed
  what real confluence backs it. Letter grades A+/A/B/C/D; the top of the range
  only unlocks when regime + catalyst/multi-timeframe actually agree.
- **Firewall** — hard discipline: no-stop, wide-spread, weak R:R, event blackout,
  lunch-chop suppression, 0DTE gamma windows, correlation-heat caps, chase guard,
  aggregate open-risk cap, profit lock, daily-loss + weekly breakers, escalating
  cooldowns. Nothing reaches a broker without passing here.
- **Exit monitor** — every open paper position is re-quoted each tick against a
  premium-based exit plan (theta-aware), with staged exits (scale at TP1, runner
  to breakeven, time stops, 0DTE flat-by) that it narrates as it goes.
- **Journal + prove-it gate** — R-multiple expectancy by regime and setup. No
  performance claim is made until ≥100 validated paper trades with positive
  expectancy and no losing regime bucket.

## Design principles

- **Explainable, not a black box.** Every signal carries the reasons it fired and
  the reasons it didn't; every gate logs why it blocked.
- **Discipline over volume.** The engine is built to pass on marginal setups. Fewer,
  better signals — flat is a position.
- **Paper-first, prove-it-gated.** Performance claims are structurally gated on a
  real sample; live execution is off until proven and unlocked.
- **Modeled honestly.** Fills include spread, slippage, commission, and theta —
  the numbers are conservative estimates, always labeled as such.
- **Forkable.** Providers (data, news, options, broker) are interfaces with mock
  and real implementations; add your own without touching the decision logic.

## Structure

```
src/
  scan/         setup detectors, MTF, contract selection, key levels, RVOL
  scoring/      the six lenses
  engine/       governor, risk firewall, exit monitor, signal registry
  context/      live market-context brain, trend stack, day-type classifier
  data/         market-data providers (mock, Alpaca, per-tick cache)
  options/      delayed options-chain flow (free, degraded-mode)
  news/         verified-headline providers + breaking-news watcher
  discord/      channel router, alert rendering, EOD recap
  backtest/     replay provider + runner (history → live pipeline, no lookahead)
  journal/      trade journal, expectancy, prove-it gate
dashboard/      Next.js dashboard (Today / Charts / History / Results / News)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the component map and extension points.

## License & use

Provided as-is for research and education. You are responsible for your own
trading decisions and for complying with the terms of any data/broker provider
you connect. Nothing here is financial advice.
