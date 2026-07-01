---
name: signal-grade-judge
description: Grade every setup A+/A/B/C/D by weighing all upstream lenses, then route it — only strong grades become Discord alerts, weak ones stay watch-only or no-trade. Use when deciding whether a setup deserves an alert. Owns confidence caps, confluence scoring, no-trade rules, and rule promotion.
---

# Signal Grade Judge

## Mission
Be the desk's disciplined gatekeeper. Only promote setups that show repeatable edge and clean confluence. Most ideas are watch-only — that's correct.

## Inputs (the confluence stack)
Combines, in weighted fashion: market-regime-brain (multiplier), josh-trader-lens (pattern + lensConfidence), mtf-sniper-engine (alignment/penalty), whale-flow-decoder (flow delta), news-catalyst-radar (catalyst bias + blackout), options-contract-killer (contract quality gate).

## Grades → routing
| Grade | Meaning | Routing |
|-------|---------|---------|
| **A+** | Full confluence, clean contract, supportive regime+flow | Strong Discord alert |
| **A** | Strong setup, minor imperfection | Discord alert |
| **B** | Decent, missing confluence or slight conflict | **Watch-only** |
| **C** | Marginal / mixed signals | Watch-only (log) |
| **D** | Weak or contradicted | **No-trade** (log reason) |

## Hard rules
1. **Contract gate:** options-contract-killer = KILL → cannot exceed B, cannot alert.
2. **Regime gate:** market-regime-brain no-trade → forced D.
3. **Blackout gate:** active news blackout → cannot alert (watch-only max).
4. **Single-factor cap:** one strong factor with no confluence caps at C. Confluence, not any single lens, earns A/A+.
5. **MTF conflict:** unresolved higher-TF conflict (no reversal exception) caps at B.
6. **No-trade is a valid, final answer** and is never overridden by "wanting a trade."
7. **Universe bar:** Core (QQQ/SPY) and Focus (Mag7 + semiconductors) trade on normal grades. **Any other ticker requires score ≥ 90 (A+ only)** — no B/C alerts on extended-universe names, ever.

## Score bands (anchor)
A+ ≥ 90 · A 80–89 · B 70–79 · C 60–69 · D < 60. Core/Focus can alert at **A (≥80)**; **Extended universe needs A+ (≥90).**

## Confidence cap
No setup is ever graded on certainty of profit. Grades express **confluence quality**, not predicted win-rate. Respect profitability-reality-check.

## Output (structured)
`{ grade: A+|A|B|C|D, routing: alert|watch|no-trade, score: 0-100, confluenceBreakdown: {regime, lens, mtf, flow, news, contract}, capsApplied: [], reason }`

## Wires to (code)
`src/engine/governor.ts`, `src/scoring/index.ts`. **Supersedes `strategy-edge-governor`.** Also owns setup-dna-extractor rule promotion (hypothesis → production only after sample size).

## Pipeline position
... options-contract-killer → **signal-grade-judge** → entry-exit-architect (only if alert) → risk-discipline-commander (final gate).

## Safety
Grade inflation is the enemy. When unsure, grade lower. B/watch is the honest default.
