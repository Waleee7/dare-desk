---
name: options-contract-killer
description: Reject bad options contracts before any strong alert. Use before choosing or approving any contract — checks volume, spread, open interest, IV, expiration, strike, and delta. A great chart with a trash contract is still a bad trade; this skill has veto power over strong alerts.
---

# Options Contract Killer

## Mission
A good stock setup with a trash option contract is still a bad trade. This skill kills contracts that can't be entered and exited cleanly on a 5–30 min scalp. It can veto an "alert" down to "watch."

## Hard reject rules (any one → cannot be a strong alert)
- **Weak volume** — contract volume too low to fill/exit a scalp without slippage.
- **Wide spread** — bid/ask spread too wide relative to premium (scalps die on spread).
- **Poor open interest** — thin OI = no one to trade against on the exit.
- **Excess IV** — IV so high the move is priced in / theta+vega risk dominates a short hold.
- **Bad expiration** — wrong DTE for a scalp (0DTE gamma risk vs too-far theta drag) given the setup.
- **Poor strike** — strike too far OTM (won't move) or too deep ITM (capital-heavy, low leverage) for the expected move.

## Scalp contract preferences (QQQ/SPY defaults, tune via setup-dna-extractor)
- Near-the-money / slightly OTM where delta ≈ 0.35–0.60 so the contract actually moves with the underlying.
- DTE matched to hold time and regime: short DTE for power-hour momentum, a little more cushion in chop.
- Tight, liquid spreads on QQQ/SPY are the norm — treat a wide one as a red flag that something's off.

## Contract quality score
Emit a 0–100 **contract quality** score + PASS / WARN / KILL. Record the score in the journal for every alert (so we can learn which contracts actually filled well).

## Output (structured)
`{ ticker, strike, expiry, delta, volume, oi, spreadPct, iv, contractQuality: 0-100, verdict: pass|warn|kill, reasons: [] }`

## Wires to (code)
`src/scan/contracts.ts`, options-chain lens in `src/scoring/index.ts`. **Supersedes `options-chain-sniper`.** Data dependency: needs a real options-chain feed (see whale-flow-decoder gap note).

## Pipeline position
... news-catalyst-radar → **options-contract-killer** → signal-grade-judge → entry-exit-architect.

## Safety
Never send a strong alert on a KILL contract, no matter how clean the chart. Contract quality is a hard gate, not a tiebreaker.
