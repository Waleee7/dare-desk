---
name: entry-exit-architect
description: Build the complete, tradeable plan for any setup graded alert-worthy — ticker, direction, contract, entry zone, stop, targets, hold time, setup type, reason, invalidation, and exit logic. Use after signal-grade-judge approves an alert, before the Discord message is formatted. Every alert MUST carry every field.
---

# Entry / Exit Architect

## Mission
Turn a graded setup into a plan a trader can act on in seconds — nothing vague, nothing missing. If a field can't be filled, the alert isn't ready.

## Required fields (ALL mandatory)
1. **Ticker** — Core / Focus / Extended name.
2. **Direction** — call / put.
3. **Contract** — strike, expiry, delta (from options-contract-killer, PASS/WARN only).
4. **Contract cost (paid)** — the *actual* per-contract fill price ($ premium) AND total $ for the position. Real fill, not an estimate.
5. **Entry timing + exact time** — "getting in NOW" vs "wait for zone/trigger", stamped with the exact clock time (HH:MM:SS ET) the bot fires.
6. **Entry zone** — a price *range* on the underlying, not a single tick.
7. **Stop** — hard invalidation price on the underlying.
8. **Targets** — T1 / T2 (and runner if regime supports it) with R:R ≥ ~1.5.
9. **Exit timeframe** — the exact 5–30 min hold band + the time to be flat by; tightened by setup type.
10. **Setup type** — which of josh-trader-lens's 9 plays.
11. **Reason** — the confluence in one or two lines.
12. **Invalidation** — the specific condition that says "wrong, exit."
13. **Exit plan** — target-scaling + trail + **time-stop** + "what breaks the thesis."

## Entry ticket (logged at fill)
The moment the bot enters, it stamps and journals: `{ enteredAt: HH:MM:SS ET, underlyingPx, contract, fillPrice, contracts, totalCost, plannedExitBy }` — so every alert carries a real entry record, not just a plan.

## Exit logic detail
- **Scale:** take partials at T1, trail the rest.
- **Time-stop:** if the move hasn't worked within the expected hold band, exit — dead scalps bleed theta.
- **Invalidation exit:** underlying hits stop → out, no averaging down.
- **Regime shift:** market-regime-brain flips hostile mid-trade → tighten or exit.

## Output (structured)
Emits the full alert object consumed by the Discord formatter — the schema `discord-alert-copilot` renders.

## Wires to (code)
`src/engine/exitPlan.ts` (plan construction), `src/discord/alert.ts` (formatting). Pairs with the complementary `discord-alert-copilot` skill for message styling.

## Pipeline position
... signal-grade-judge (alert) → **entry-exit-architect** → risk-discipline-commander (final approval) → Discord.

## Safety
No alert ships with a missing field. No stop = no trade. Targets must give real R:R, not hope. Every plan states what would make it fail.
