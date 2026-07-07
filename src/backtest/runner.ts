// The replay runner — drives the EXACT live pipeline over history, stepping a
// virtual clock through market hours. Scanner → engine.evaluateIdea → exit
// monitor, all reading only bars <= virtualNow, all timing off the injected
// clock. Because nothing here is a re-implementation, a positive expectancy in
// replay is real evidence for the live paper stream (same code, same gates).

import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DareDeskEngine } from '../pipeline.js';
import { Scanner } from '../scan/scanner.js';
import { ExitMonitor } from '../engine/exitMonitor.js';
import { selectBroker, toOrder } from '../broker/index.js';
import { buildMarketContext } from '../context/marketContext.js';
import { fullUniverse } from '../scan/universe.js';
import { setClockNow, nowEt, inMarketHours } from '../lib/clock.js';
import { computeExpectancy } from './index.js';
import type { ClosedTrade, ExpectancyStats, Grade } from '../lib/types.js';
import { ReplayMarketDataProvider, type BarStore } from './replayProvider.js';

export interface BacktestOptions {
  store: BarStore;
  stepMinutes?: number;   // clock advance per tick (default 5)
  sandboxDir?: string;    // where the replay's day/journal/positions live (wiped first)
  /** Grades that open a (paper) position in the replay. Default ['A+','A'] = the
   *  live fire set. Add 'B' to also measure the watch line (a shadow book) — useful
   *  to build the prove-it sample faster and to test whether B setups carry edge. */
  fireGrades?: Grade[];
  onDay?: (date: string, closed: number) => void;
}

export interface BacktestReport {
  ticks: number;
  scannedDays: number;
  signalsFired: number;
  closed: ClosedTrade[];
  expectancy: ExpectancyStats;
  bySetup: { setup: string; trades: number; expectancyR: number; wins: number }[];
  span: { start: string; end: string };
}

export async function runBacktest(opts: BacktestOptions): Promise<BacktestReport> {
  const step = (opts.stepMinutes ?? 5) * 60_000;
  const sandbox = opts.sandboxDir ?? join(process.cwd(), 'data', 'backtest');
  // Start clean — the replay must not inherit or clobber any real state.
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* fresh */ }
  mkdirSync(sandbox, { recursive: true });

  const replay = new ReplayMarketDataProvider(opts.store, 'replay');
  const { startMs, endMs } = replay.span();
  const engine = new DareDeskEngine({
    dataDir: sandbox,
    now: () => replay.now(),
    quote: (t) => replay.getQuote(t),
  });
  const scanner = new Scanner(replay);
  const exitMonitor = new ExitMonitor(join(sandbox, 'positions.json'));

  const universe = fullUniverse();
  const fireGrades = new Set<Grade>(opts.fireGrades ?? ['A+', 'A']);
  let ticks = 0;
  let signalsFired = 0;
  const daysSeen = new Set<string>();

  // Begin one hour into the first session so indicators have warm-up bars.
  for (let t = startMs + 60 * 60_000; t <= endMs; t += step) {
    setClockNow(t);
    replay.setNow(t);
    if (!inMarketHours(new Date(t))) continue;
    ticks++;
    const date = nowEt(new Date(t)).toISOString().slice(0, 10);
    const before = engine.journal.closedTrades().length;

    engine.rollDay();

    // Manage open positions first (re-quote vs plan, book closes), then hunt.
    await exitMonitor.check(replay, engine, t);

    const ctx = await buildMarketContext(replay, universe);
    const candidates = await scanner.scanOnce(0.5, ctx.vix);
    for (const idea of candidates) {
      const res = await engine.evaluateIdea(idea, ctx);
      const g = res.decision.grade;
      // Extended-tier names only ever trade at A+ (the live rule), whatever the fire set.
      const tradeable = res.firewall.approved && fireGrades.has(g) && !(res.alert.tier === 'extended' && g !== 'A+');
      if (!tradeable) continue;
      // A+/A already got a broker fill from the pipeline; a watch-grade (B) in the
      // fire set needs a paper fill placed here to be managed as a shadow position.
      let managed = res;
      if (!res.broker?.accepted && res.firewall.positionContracts > 0) {
        const broker = await selectBroker(false, false).place(toOrder(res.idea, res.firewall));
        managed = { ...res, broker };
      }
      if (managed.broker?.accepted) { exitMonitor.open(managed, ctx.spyTrend, t); signalsFired++; }
    }

    if (!daysSeen.has(date)) {
      daysSeen.add(date);
      opts.onDay?.(date, engine.journal.closedTrades().length - before);
    }
  }

  setClockNow(null); // release the clock back to real time

  const closed = [...engine.journal.closedTrades()];
  const expectancy = computeExpectancy(closed);
  return {
    ticks,
    scannedDays: daysSeen.size,
    signalsFired,
    closed,
    expectancy,
    bySetup: setupTable(closed),
    span: { start: new Date(startMs).toISOString().slice(0, 10), end: new Date(endMs).toISOString().slice(0, 10) },
  };
}

/** Per-setup expectancy — which plays actually made money over the replay. */
function setupTable(closed: ClosedTrade[]): BacktestReport['bySetup'] {
  const by = new Map<string, ClosedTrade[]>();
  for (const t of closed) {
    const arr = by.get(t.setup) ?? [];
    arr.push(t);
    by.set(t.setup, arr);
  }
  return [...by.entries()]
    .map(([setup, arr]) => ({
      setup,
      trades: arr.length,
      wins: arr.filter((t) => t.result === 'win').length,
      expectancyR: Math.round((arr.reduce((s, t) => s + t.rMultiple, 0) / arr.length) * 100) / 100,
    }))
    .sort((a, b) => b.trades - a.trades);
}
