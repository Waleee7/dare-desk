---
name: whale-flow-decoder
description: Decode options order flow as CONFIRMATION for QQQ/SPY scalps — sweeps, blocks, unusual volume, high-premium orders, put/call imbalance, highest-volume strikes, OI clusters, and gamma magnet zones. Use to confirm a setup, never as the sole reason to trade. Flow agrees or it doesn't; it doesn't originate signals.
---

# Whale Flow Decoder

## Mission
Read where size is positioning and use it to confirm — or veto — a setup that josh-trader-lens already found. Flow is a tailwind, not a thesis.

## What it tracks
- **Sweeps** — aggressive multi-exchange fills paying the ask/bid (urgency).
- **Blocks** — large single prints, often negotiated (institutional positioning).
- **Unusual volume** — volume >> open interest on a strike (new positioning).
- **High-premium orders** — large $ notional, not just contract count.
- **Put/call imbalance** — directional skew in the flow.
- **Highest-volume strikes** — where the crowd is; magnets and battle lines.
- **OI clusters** — walls that price gravitates to / stalls at.
- **Gamma magnet zones** — dealer-hedging levels that pin or accelerate price.

## Rules
1. **Confirmation only.** Flow raises or lowers confidence on an existing setup; it never creates one alone.
2. Flow **against** the setup direction is a warning → reduce grade or flip to watch.
3. Note the nearest gamma magnet / high-volume strike as a target or obstacle for entry-exit-architect.
4. Distinguish opening (new) flow from closing flow — closing flow is weaker confirmation.

## Output (structured)
`{ netFlowBias: bullish|bearish|mixed, sweeps: n, blocks: n, unusualStrikes: [], gammaMagnets: [], flowAgreesWithSetup: bool, flowConfidenceDelta }`

## Data sources (FREE-only, per Josh)
Real-time institutional flow (sweeps/blocks tape) is paid-only and is NOT used. Derive what free data allows and stay honest about the rest:
- **Options chain + volume/OI:** Yahoo Finance (free, ~15-min delayed), CBOE delayed, Tradier sandbox — snapshot the chain each cycle.
- **Unusual volume:** compute volume ÷ open-interest per strike (>~2–3× = unusual). Free and real.
- **Highest-volume strikes + OI clusters:** read straight from the chain snapshot.
- **Gamma magnet zones (GEX):** estimate dealer gamma from free OI — no paid feed needed.
- **Put/call imbalance:** total put vs call volume from the chain.

### Honesty rule (important)
Free flow is **delayed (~15 min)** with **no true sweep/block tape**. For 5–30 min scalps, treat it as *soft context*, not hard real-time confirmation. Sweeps/blocks = marked "unavailable (free)" — never fabricate them. Absence of flow ≠ bullish.

## Wires to (code)
NEW — no implementation yet. Nearest existing hook: options-chain lens in `src/scoring/index.ts`. Needs new `src/flow/` module + data provider.

## Pipeline position
... mtf-sniper-engine → **whale-flow-decoder** → news-catalyst-radar → options-contract-killer → signal-grade-judge.

## Safety
Never trade on flow alone — it's often exit hedging, spreads, or noise. No flow data ≠ bullish. Absence of confirmation is not confirmation.
