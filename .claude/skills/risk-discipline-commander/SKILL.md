---
name: risk-discipline-commander
description: Final risk gate before any alert, paper trade, or broker-ready order. Use whenever a trade is being approved, sized, or sent. Prevents overtrading; blocks during chop, low liquidity, bad contracts, major-news windows, and after too many losses; enforces daily max signals, loss lockout, and risk mode.
---

# Risk Discipline Commander

## Mission
Protect the trader from bad conditions, tilt, overtrading, and bot overconfidence. This is the last gate — it can veto anything, including an A+. Capital preservation over any single trade.

## Hard blocks (any one → no alert/order)
- **Chop / unclear regime** — market-regime-brain says chop, range-middle, or no-trade.
- **Low liquidity** — thin tape or options-contract-killer WARN/KILL on the contract.
- **Bad contract** — contract-quality gate failed.
- **Major-news window** — news-catalyst-radar active blackout.
- **Loss streak** — consecutive losses ≥ threshold today → **loss lockout**.

## Counters & modes (persisted daily)
- **Daily max signals** — cap alerts per day; extra qualifying setups become watch-only.
- **Loss lockout** — after N losses, stop new alerts for a cooldown / rest of session.
- **Cooldown** — minimum spacing between alerts to prevent machine-gunning a chop tape.
- **Max daily loss** — hard stop for the day when hit.
- **Risk mode** — `normal` / `cautious` (after a loss or in low-vol-trap) / `locked`. Mode scales daily caps and required grade (e.g. cautious = A/A+ only).

## Correlation & heat (a 21-yr-trader must-have)
QQQ, SPY, NVDA, AMD, SMH, SOXL, and the Mag7 are largely **the same trade**. Cap total *correlated* exposure — 4 long-tech signals ≠ 4 independent trades, it's one oversized position.
- **Max concurrent correlated risk:** limit simultaneous same-direction tech/semis/index exposure (portfolio "heat"), not just per-trade risk.
- **Chase guard:** if price has already left the entry zone by more than a set buffer, the trade is **gone** — no chasing. #1 retail killer.
- **Name-level cooldown:** after a loss on a ticker, lock *that name* for a cooldown (kills the revenge trade), independent of the global cooldown.

## Sizing
Risk-based position sizing tied to stop distance and account risk-per-trade — never fixed contract counts. (Live sizing/orders stay disabled by default; paper-first.)

## Output (structured)
`{ approved: bool, blocks: [], riskMode, signalsToday, lossesToday, dailyPnL, sizingSuggestion, reason }`

## Wires to (code)
`src/engine/firewall.ts`, daily state in `src/lib/state.ts` / `data/state.json`. **Supersedes `risk-discipline-firewall`.**

## Pipeline position
... entry-exit-architect → **risk-discipline-commander** (FINAL gate) → Discord / paper broker. Coordinates blackout with news-catalyst-radar and no-trade with market-regime-brain.

## Safety
This gate is never bypassed — not by Josh's conviction, not by an A+ grade, not by FOMO. Overtrading is the #1 account killer; when in doubt, block. Never promise profitability; enforce discipline.
