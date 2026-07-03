// The Exit Monitor — the piece that makes expectancy real. The Exit Brain writes
// the plan on every alert; THIS watches every open paper position against that
// plan each tick, TALKS about what it's doing ("looking to get out at $1.61"),
// and drives engine.closeTrade() so the prove-it counter actually climbs.
//
// Lifecycle per position:
//   opened → (approaching_tp1) → tp1_scaled (bank half, stop → breakeven)
//          → target_hit | stopped | time_stop | flat_by_close  (full close)
// One position = ONE closed trade at a blended exit premium (TP1 half + runner
// half), so heat slots free once and expectancy stays clean. All fills MODELED —
// premium re-quotes come from the same delta/gamma model the Exit Brain planned
// with, marked to the LIVE underlying quote. Positions persist to
// data/positions.json so a runner restart never orphans a trade.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MarketDataProvider } from '../data/provider.js';
import type { OpenPosition, ExitEvent, ExitEventKind, ClosedTrade } from '../lib/types.js';
import type { EvaluationResult } from '../pipeline.js';
import { estDelta, premiumNow, premiumPct } from '../scan/contracts.js';
import { etTimeString, etMinutes } from '../lib/clock.js';
import { config } from '../lib/config.js';

/** What the monitor needs to book a close — PremiumFloorEngine satisfies this. */
export interface TradeCloser {
  closeTrade(args: {
    ticker: string; direction: 'long' | 'short'; setup: string; tier: OpenPosition['tier'];
    entryTimeEt: string; exitTimeEt: string;
    fillPremium: number; exitPremium: number; contracts: number; costPaidUsd: number; stopPremium: number;
    regime: 'up' | 'down' | 'flat'; now?: number;
  }): ClosedTrade;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${round2(n).toFixed(2)}`;
const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;

// Exit fills eat friction too — you sell at the bid side, not the mid.
const exitFriction = () => (config.fills.bidAskSpreadPct / 2 + config.fills.slippagePct) / 100;

const MARKET_FLAT_MIN_ET = 958; // 15:58 ET — non-swing positions never hold the close

export class ExitMonitor {
  private open_: OpenPosition[] = [];

  constructor(private readonly filePath = join(process.cwd(), 'data', 'positions.json')) {
    this.load();
  }

  positions(): readonly OpenPosition[] { return this.open_; }

  /** Track a fresh paper fill. Returns the position (with its 'opened' event) or
   *  null when the result didn't actually fill (watch grades, rejected, zero size). */
  open(res: EvaluationResult, regime: 'up' | 'down' | 'flat', nowMs = Date.now()): OpenPosition | null {
    const b = res.broker;
    if (!b?.accepted || b.fillPremium == null || res.firewall.positionContracts <= 0) return null;

    const ep = res.alert.exitPlan;
    const tp1 = ep.takeProfits[0]?.premium ?? 0;
    const tp2 = ep.takeProfits[1]?.premium ?? 0;
    const contracts = res.firewall.positionContracts;

    const pos: OpenPosition = {
      id: b.orderId ?? `paper-${res.idea.alertId}`,
      ticker: res.idea.ticker,
      direction: res.idea.direction,
      setup: res.idea.setup,
      tier: res.alert.tier,
      grade: res.decision.grade,
      contract: res.idea.contract,
      horizon: res.idea.timeframe ?? 'intraday',
      contracts,
      initialContracts: contracts,
      entryTimeEt: res.alert.entryTimeEt,
      openedAtMs: nowMs,
      minutesToCloseAtEntry: Math.max(15, Math.min(390, 960 - etMinutes(new Date(nowMs)))),
      entryUnderlying: res.idea.entry,
      fillPremium: b.fillPremium,
      costPaidUsd: b.costPaidUsd ?? round2(b.fillPremium * 100 * contracts),
      delta: estDelta(res.idea.timeframe ?? 'intraday'),
      tp1Premium: tp1,
      tp2Premium: tp2,
      stopPremium: ep.stop.premium,
      timeStopMin: ep.timeStopMin,
      zeroDte: res.idea.contract.dte === 0,
      status: 'open',
      scaledOutPremium: null,
      warnedTp1: false,
      warnedStop: false,
      regime,
      lastEstPremium: b.fillPremium,
      lastUnderlying: res.idea.entry,
      events: [],
    };

    const ev = this.event(pos, 'opened', b.fillPremium,
      `🟢 ${pos.ticker} ${pos.direction === 'long' ? 'CALLS' : 'PUTS'} ON — ${contracts}x ${pos.contract.strike}${pos.contract.optionType === 'call' ? 'C' : 'P'} @ ${money(b.fillPremium)} (modeled). `
      + `Watching: TP1 ${tp1 > 0 ? money(tp1) : '—'} · stop ${ep.stop.premium > 0 ? money(ep.stop.premium) : '—'}`
      + `${ep.timeStopMin > 0 ? ` · time stop ${ep.timeStopMin}m` : ''}${pos.zeroDte ? ' · 0DTE flat by 15:55' : ''}.`);
    this.open_.push(pos);
    this.save();
    return { ...pos, events: [ev] };
  }

  /**
   * One monitoring pass: re-quote every open position against the live underlying,
   * emit transitions, and book full closes through `closer`. Returns the events
   * (already attached to positions) for Discord/dashboard. Never throws — a quote
   * failure just skips that position until next tick.
   */
  async check(provider: MarketDataProvider, closer: TradeCloser, nowMs = Date.now()): Promise<ExitEvent[]> {
    const events: ExitEvent[] = [];
    const still: OpenPosition[] = [];

    for (const pos of this.open_) {
      let closed = false;
      try {
        const est = await this.estimatePremium(provider, pos, nowMs);
        pos.lastEstPremium = est.premium;
        pos.lastUnderlying = est.underlying;
        closed = this.transition(pos, est.premium, est.worst, closer, nowMs, events);
      } catch {
        // Feed hiccup — keep the position, retry next tick.
      }
      if (!closed) still.push(pos);
    }

    this.open_ = still;
    this.save();
    return events;
  }

  /** Dashboard view of what's on — live premium, P/L, distance to the exits. */
  views(): Array<OpenPosition & { plPct: number | null; plUsd: number | null }> {
    return this.open_.map((p) => {
      const est = p.lastEstPremium;
      const plPct = est != null ? premiumPct(p.fillPremium, est) : null;
      const plUsd = est != null ? round2((est - p.fillPremium) * 100 * p.contracts) : null;
      return { ...p, plPct, plUsd };
    });
  }

  // --- internals -----------------------------------------------------------------

  /** Modeled premium marked to the live underlying: delta/gamma move MINUS the
   *  theta bleed for time already spent in the trade. `worst` marks the premium
   *  at the latest 1m bar's adverse extreme — catches intrabar stop-throughs the
   *  last-trade quote missed. No entry level on file → premium decays in place. */
  private async estimatePremium(
    provider: MarketDataProvider,
    pos: OpenPosition,
    nowMs: number,
  ): Promise<{ premium: number; worst: number; underlying: number | null }> {
    const hold = {
      dte: pos.contract.dte ?? 1,
      elapsedMin: (nowMs - pos.openedAtMs) / 60_000,
      minutesToCloseAtEntry: pos.minutesToCloseAtEntry ?? 390,
    };
    const mark = (underlying: number): number => {
      const move = Math.abs(underlying - pos.entryUnderlying!);
      const favorable = pos.direction === 'long'
        ? underlying >= pos.entryUnderlying!
        : underlying <= pos.entryUnderlying!;
      return premiumNow(pos.fillPremium, pos.delta, move, pos.horizon, favorable, hold);
    };

    if (pos.entryUnderlying == null) {
      const decayed = premiumNow(pos.fillPremium, pos.delta, 0, pos.horizon, true, hold);
      return { premium: decayed, worst: decayed, underlying: pos.lastUnderlying };
    }

    const q = await provider.getQuote(pos.ticker);
    const premium = mark(q.price);
    // Adverse intrabar extreme — a stop can be hit between our 120s looks.
    let worst = premium;
    try {
      const bars = await provider.getBars(pos.ticker, '1Min', 2);
      const lastBar = bars[bars.length - 1];
      if (lastBar) worst = Math.min(premium, mark(pos.direction === 'long' ? lastBar.l : lastBar.h));
    } catch {
      // No bars — the quote mark stands.
    }
    return { premium, worst, underlying: q.price };
  }

  /** Apply the state machine for one position. Returns true when fully closed.
   *  `worst` = premium at the latest bar's adverse extreme — stops trigger on it
   *  (conservative ordering: an intrabar stop-through beats a later recovery). */
  private transition(
    pos: OpenPosition,
    est: number,
    worst: number,
    closer: TradeCloser,
    nowMs: number,
    out: ExitEvent[],
  ): boolean {
    const now = new Date(nowMs);
    const pct = premiumPct(pos.fillPremium, est);
    const sellAt = round2(Math.max(0.01, est * (1 - exitFriction()))); // calm exit
    // Forced exits happen when everyone else is exiting — spreads blow out.
    const sellFast = round2(Math.max(0.01, est * (1 - exitFriction() * 2.5)));
    const stop = pos.status === 'runner' ? pos.fillPremium : pos.stopPremium; // runner rides free at breakeven
    const elapsedMin = (nowMs - pos.openedAtMs) / 60_000;

    // --- Clock exits first: discipline beats levels ---
    if (pos.zeroDte && etMinutes(now) >= config.risk.zeroDteFlatByMinEt) {
      out.push(this.close(pos, closer, sellFast, nowMs, 'flat_by_close',
        `🕒 ${pos.ticker} 0DTE flat-by — out in full at ~${money(sellFast)} (${signedPct(pct)}). Never hold 0DTE into the close.`));
      return true;
    }
    if (pos.horizon !== 'swing' && etMinutes(now) >= MARKET_FLAT_MIN_ET) {
      out.push(this.close(pos, closer, sellFast, nowMs, 'flat_by_close',
        `🕒 ${pos.ticker} flat into the close — out at ~${money(sellFast)} (${signedPct(pct)}). Intraday trades don't sleep over.`));
      return true;
    }
    if (pos.timeStopMin > 0 && elapsedMin >= pos.timeStopMin) {
      out.push(this.close(pos, closer, sellAt, nowMs, 'time_stop',
        `⏱ ${pos.ticker} time stop (${pos.timeStopMin}m) — out at ~${money(sellAt)} (${signedPct(pct)}). The move didn't come; theta wins the stall.`));
      return true;
    }

    // --- Stop side (triggered on the intrabar worst mark, exited fast-market) ---
    if (stop > 0) {
      if (worst <= stop) {
        const at = round2(Math.min(Math.max(0.01, worst * (1 - exitFriction() * 2.5)), stop));
        const kind: ExitEventKind = 'stopped';
        const note = pos.status === 'runner'
          ? `🛑 ${pos.ticker} runner back to breakeven — out at ~${money(at)}. TP1 half already banked; scratch the rest, keep the win.`
          : `🛑 ${pos.ticker} STOPPED ${signedPct(premiumPct(pos.fillPremium, at))} — out in full at ~${money(at)}. Cut it, no averaging down. Next.`;
        out.push(this.close(pos, closer, at, nowMs, kind, note));
        return true;
      }
      if (!pos.warnedStop && pos.status === 'open' && est <= round2(stop * 1.1)) {
        pos.warnedStop = true;
        out.push(this.event(pos, 'approaching_stop', est,
          `⚠️ ${pos.ticker} ${signedPct(pct)} — LOOKING TO GET OUT: premium ~${money(est)} vs stop ${money(stop)}. If it loses ${money(stop)}, we're gone.`, nowMs));
      }
    }

    // --- Profit side ---
    if (pos.status === 'open' && pos.tp1Premium > 0) {
      if (est >= pos.tp1Premium) {
        if (pos.initialContracts <= 1) {
          // Can't split one lot — the base hit IS the trade.
          out.push(this.close(pos, closer, sellAt, nowMs, 'target_hit',
            `💰 ${pos.ticker} TP1 HIT ${signedPct(pct)} — 1 lot, banked in full at ~${money(sellAt)}. Base hit, on to the next.`));
          return true;
        }
        const sold = Math.round(pos.initialContracts / 2);
        pos.status = 'runner';
        pos.scaledOutPremium = sellAt;
        pos.contracts = pos.initialContracts - sold;
        pos.warnedStop = false; // re-arm the warning for the breakeven stop
        out.push(this.event(pos, 'tp1_scaled', est,
          `💰 ${pos.ticker} TP1 HIT ${signedPct(pct)} — sold ${sold}x at ~${money(sellAt)}, banked. `
          + `${pos.contracts}x runner stays on, stop moved to BREAKEVEN (${money(pos.fillPremium)}). Let it cook.`, nowMs));
      } else if (!pos.warnedTp1 && est >= round2(pos.tp1Premium * 0.9)) {
        pos.warnedTp1 = true;
        out.push(this.event(pos, 'approaching_tp1', est,
          `👀 ${pos.ticker} ${signedPct(pct)} — approaching TP1 ${money(pos.tp1Premium)}. Looking to bank ${pos.initialContracts > 1 ? 'half' : 'it'} there.`, nowMs));
      }
      return false;
    }

    if (pos.status === 'runner' && pos.tp2Premium > 0 && est >= pos.tp2Premium) {
      out.push(this.close(pos, closer, sellAt, nowMs, 'target_hit',
        `🎯 ${pos.ticker} RUNNER PAID ${signedPct(pct)} — out in full at ~${money(sellAt)}. That's the base hit + the runner. Textbook.`));
      return true;
    }

    return false;
  }

  /** Book the full close: blended exit premium across the TP1 half + the rest. */
  private close(
    pos: OpenPosition,
    closer: TradeCloser,
    finalPremium: number,
    nowMs: number,
    kind: ExitEventKind,
    message: string,
  ): ExitEvent {
    const sold = pos.initialContracts - pos.contracts;
    const blended = sold > 0 && pos.scaledOutPremium != null
      ? round2((pos.scaledOutPremium * sold + finalPremium * pos.contracts) / pos.initialContracts)
      : finalPremium;

    const ct = closer.closeTrade({
      ticker: pos.ticker,
      direction: pos.direction,
      setup: pos.setup,
      tier: pos.tier,
      entryTimeEt: pos.entryTimeEt,
      exitTimeEt: etTimeString(new Date(nowMs)),
      fillPremium: pos.fillPremium,
      exitPremium: blended,
      contracts: pos.initialContracts,
      costPaidUsd: pos.costPaidUsd,
      stopPremium: pos.stopPremium > 0 ? pos.stopPremium : round2(pos.fillPremium * 0.65),
      regime: pos.regime,
      now: nowMs,
    });

    return this.event(pos, kind, finalPremium,
      `${message} ${ct.pnlUsd >= 0 ? '+' : ''}$${ct.pnlUsd} (${ct.rMultiple >= 0 ? '+' : ''}${ct.rMultiple}R, modeled).`, nowMs);
  }

  private event(pos: OpenPosition, kind: ExitEventKind, est: number | null, message: string, nowMs = Date.now()): ExitEvent {
    const ev: ExitEvent = {
      at: new Date(nowMs).toISOString(),
      etTime: etTimeString(new Date(nowMs)),
      kind,
      ticker: pos.ticker,
      positionId: pos.id,
      message,
      estPremium: est != null ? round2(est) : null,
      premiumPct: est != null ? premiumPct(pos.fillPremium, est) : null,
    };
    pos.events.push(ev);
    return ev;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as { positions?: OpenPosition[] };
      this.open_ = Array.isArray(data.positions) ? data.positions : [];
    } catch {
      this.open_ = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify({ positions: this.open_ }, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort — never let a disk hiccup kill the runner.
    }
  }
}
