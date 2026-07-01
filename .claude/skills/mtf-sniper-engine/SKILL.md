---
name: mtf-sniper-engine
description: Multi-timeframe confirmation engine for QQQ/SPY scalps. Use whenever a setup from josh-trader-lens needs timeframe alignment before it can be graded. Confirms entries across 1m/3m/5m/15m/30m/1h/daily and penalizes conflicting timeframes unless a strong reversal is present.
---

# MTF Sniper Engine

## Mission
A scalp is only as good as its timeframe agreement. Confirm the trigger TF against higher-TF structure, and penalize confidence when timeframes fight — unless the setup is an intentional, strong reversal.

## Timeframe roles
| TF | Role |
|----|------|
| **1m** | Entry trigger (the fire candle) |
| **3m** | Micro confirmation (trigger isn't a 1m fakeout) |
| **5m** | Scalp confirmation (the trade's home timeframe) |
| **15m** | Intraday bias (with-trend vs counter-trend) |
| **30m / 1h** | Larger structure (are we into a wall?) |
| **Daily** | Key levels (PDH/PDL, prior close, major S/R, gap fills) |

## Alignment scoring
- **Aligned (all/most agree with direction):** full confidence, boost.
- **Mixed (higher TF neutral):** allowed, no boost.
- **Conflict (higher TF opposes trigger):** apply a **penalty** to lensConfidence. Size the penalty by how many TFs conflict and how high (15m conflict < daily conflict).
- **Exception:** if josh-trader-lens tagged a **reversal scalp / liquidity sweep / fakeout** AND the reversal signature is strong (clear exhaustion + rejection at a daily level), reduce the penalty — that's the whole point of the play.

## Rules
1. Never fire a with-trend scalp straight into a same-TF opposing wall (e.g. long into daily resistance) without a reversal tag.
2. Trigger TF (1m) must be confirmed by at least 3m before "alert."
3. Higher-TF key levels (daily) are hard reference points, not suggestions — note distance-to-level in every read.

## Output (structured)
`{ tfReads: {1m,3m,5m,15m,30m,1h,daily}, alignment: aligned|mixed|conflict, conflictCount, penaltyApplied, reversalException: bool, mtfConfidenceDelta }`

## Wires to (code)
`src/scan/mtf.ts`. Consumes josh-trader-lens output; adjusts confidence handed to signal-grade-judge.

## Pipeline position
market-regime-brain → josh-trader-lens → **mtf-sniper-engine** → whale-flow-decoder → ... → signal-grade-judge.

## Safety
Timeframe conflict is a real cost. Do not let a clean 1m trigger override a hostile daily structure without an explicit, strong reversal case.
