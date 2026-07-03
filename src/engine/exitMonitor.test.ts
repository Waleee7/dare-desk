import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExitMonitor, type TradeCloser } from './exitMonitor.js';
import type { EvaluationResult } from '../pipeline.js';
import type { Bar, Quote, BarTimeframe, MarketDataProvider } from '../data/provider.js';
import type { ClosedTrade } from '../lib/types.js';

// 12:00 ET on a July weekday (EDT = UTC-4) — mid-session, no clock exits in play.
const NOON_ET = Date.UTC(2026, 6, 1, 16, 0, 0);
const AT_1559_ET = Date.UTC(2026, 6, 1, 19, 59, 0);

class FakeProvider implements MarketDataProvider {
  readonly name = 'fake';
  readonly realtime = true;
  price = 100;
  async getBars(_s: string, _t: BarTimeframe, _l: number): Promise<Bar[]> { return []; }
  async getQuote(symbol: string): Promise<Quote> { return { symbol, price: this.price, t: Date.now() }; }
}

class FakeCloser implements TradeCloser {
  calls: Parameters<TradeCloser['closeTrade']>[0][] = [];
  closeTrade(args: Parameters<TradeCloser['closeTrade']>[0]): ClosedTrade {
    this.calls.push(args);
    const pnlUsd = Math.round((args.exitPremium - args.fillPremium) * 100 * args.contracts * 100) / 100;
    const riskUsd = Math.max(1, (args.fillPremium - args.stopPremium) * 100 * args.contracts);
    return {
      ticker: args.ticker, setup: args.setup, tier: args.tier,
      entryTimeEt: args.entryTimeEt, exitTimeEt: args.exitTimeEt,
      fillPremium: args.fillPremium, exitPremium: args.exitPremium, contracts: args.contracts,
      costPaidUsd: args.costPaidUsd, pnlUsd,
      rMultiple: Math.round((pnlUsd / riskUsd) * 100) / 100,
      holdMinutes: 30, result: pnlUsd >= 0 ? 'win' : 'loss', regime: args.regime,
    };
  }
}

/** Minimal fired evaluation: 2x intraday calls, fill $2.00, TP1 $2.60, TP2 $3.20, stop $1.20. */
function firedResult(overrides: { contracts?: number; dte?: number; timeStopMin?: number } = {}): EvaluationResult {
  const contracts = overrides.contracts ?? 2;
  return {
    idea: {
      alertId: 'test-1', ticker: 'NVDA', direction: 'long', setup: 'Range breakout',
      contract: { ticker: 'NVDA', optionType: 'call', strike: 100, expiry: '2026-07-03', dte: overrides.dte ?? 3 },
      entry: 100, stop: 98.4, targets: [101.6, 102.6], premium: 2.0, timeframe: 'intraday', tier: 'focus',
    },
    decision: { grade: 'A' } ,
    firewall: { approved: true, blocks: [], warnings: [], positionContracts: contracts, maxLossUsd: 400, stop: 98.4, targets: [101.6, 102.6], rewardRisk: 2 },
    alert: {
      tier: 'focus', entryTimeEt: '10:30:00',
      exitPlan: {
        style: 'runner', holdWindow: '', timeStopMin: overrides.timeStopMin ?? 120,
        takeProfits: [
          { label: 'TP1 · base hit', premium: 2.6, premiumPct: 30, underlying: 101.2, action: '' },
          { label: 'TP2 · runner', premium: 3.2, premiumPct: 60, underlying: 102.4, action: '' },
        ],
        stop: { label: 'Stop', premium: 1.2, premiumPct: -40, underlying: 98.4, action: '' },
        trail: '', runnerTrigger: '', invalidation: '',
      },
    },
    broker: { accepted: true, mode: 'paper', message: '', orderId: 'paper-test-1', fillPremium: 2.0, costPaidUsd: 401.3 },
    journalEntry: {},
  } as unknown as EvaluationResult;
}

let dir: string;
let monitor: ExitMonitor;
let provider: FakeProvider;
let closer: FakeCloser;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exitmon-'));
  monitor = new ExitMonitor(join(dir, 'positions.json'));
  provider = new FakeProvider();
  closer = new FakeCloser();
});

describe('ExitMonitor.open', () => {
  it('ignores results that did not fill', () => {
    const res = firedResult();
    (res as { broker: { accepted: boolean } }).broker.accepted = false;
    expect(monitor.open(res, 'up', NOON_ET)).toBeNull();
    expect(monitor.positions().length).toBe(0);
  });

  it('tracks a fill and announces it', () => {
    const pos = monitor.open(firedResult(), 'up', NOON_ET);
    expect(pos).not.toBeNull();
    expect(pos!.events[0]!.kind).toBe('opened');
    expect(monitor.positions().length).toBe(1);
  });

  it('persists across restarts', () => {
    monitor.open(firedResult(), 'up', NOON_ET);
    const reloaded = new ExitMonitor(join(dir, 'positions.json'));
    expect(reloaded.positions().length).toBe(1);
    expect(reloaded.positions()[0]!.ticker).toBe('NVDA');
  });
});

describe('exit flow', () => {
  it('warns approaching TP1 exactly once', async () => {
    monitor.open(firedResult(), 'up', NOON_ET);
    provider.price = 100.68; // est ≈ $2.34, inside the 90%-of-TP1 window
    const ev1 = await monitor.check(provider, closer, NOON_ET + 60_000);
    expect(ev1.map((e) => e.kind)).toContain('approaching_tp1');
    const ev2 = await monitor.check(provider, closer, NOON_ET + 120_000);
    expect(ev2.length).toBe(0);
  });

  it('banks half at TP1, moves stop to breakeven, then scratches the runner', async () => {
    monitor.open(firedResult(), 'up', NOON_ET);
    provider.price = 101.5; // est ≈ $2.76 ≥ TP1 $2.60
    const ev1 = await monitor.check(provider, closer, NOON_ET + 60_000);
    expect(ev1.map((e) => e.kind)).toContain('tp1_scaled');
    const pos = monitor.positions()[0]!;
    expect(pos.status).toBe('runner');
    expect(pos.contracts).toBe(1);
    expect(closer.calls.length).toBe(0); // nothing booked yet — runner still on

    provider.price = 100; // move gone — est back to fill = breakeven stop
    const ev2 = await monitor.check(provider, closer, NOON_ET + 120_000);
    expect(ev2.map((e) => e.kind)).toContain('stopped');
    expect(monitor.positions().length).toBe(0);
    expect(closer.calls.length).toBe(1);
    const call = closer.calls[0]!;
    expect(call.contracts).toBe(2); // one blended close for the whole position
    expect(call.exitPremium).toBeGreaterThan(2.0); // TP1 half keeps it green
  });

  it('warns near the stop, then cuts it in full', async () => {
    monitor.open(firedResult(), 'up', NOON_ET);
    provider.price = 98.55; // est ≈ $1.28 — inside the stop-warning zone
    const ev1 = await monitor.check(provider, closer, NOON_ET + 60_000);
    expect(ev1.map((e) => e.kind)).toContain('approaching_stop');
    expect(ev1.find((e) => e.kind === 'approaching_stop')!.message).toContain('LOOKING TO GET OUT');

    provider.price = 98.3; // est ≈ $1.15 ≤ stop $1.20
    const ev2 = await monitor.check(provider, closer, NOON_ET + 120_000);
    expect(ev2.map((e) => e.kind)).toContain('stopped');
    expect(closer.calls.length).toBe(1);
    expect(closer.calls[0]!.exitPremium).toBeLessThanOrEqual(1.2);
    expect(monitor.positions().length).toBe(0);
  });

  it('closes a 1-lot position in full at TP1', async () => {
    monitor.open(firedResult({ contracts: 1 }), 'up', NOON_ET);
    provider.price = 101.5;
    const ev = await monitor.check(provider, closer, NOON_ET + 60_000);
    expect(ev.map((e) => e.kind)).toContain('target_hit');
    expect(closer.calls[0]!.contracts).toBe(1);
    expect(monitor.positions().length).toBe(0);
  });

  it('exits on the time stop when the move never comes', async () => {
    // Open at 10:00 ET so the 120m time stop lands mid-session (12:01 ET).
    const at10 = Date.UTC(2026, 6, 1, 14, 0, 0);
    monitor.open(firedResult(), 'up', at10);
    provider.price = 100.2; // drifting, no exit level in play
    const ev = await monitor.check(provider, closer, at10 + 121 * 60_000);
    expect(ev.map((e) => e.kind)).toContain('time_stop');
    expect(monitor.positions().length).toBe(0);
  });

  it('forces intraday positions flat into the close', async () => {
    monitor.open(firedResult({ timeStopMin: 600 }), 'up', NOON_ET);
    provider.price = 100.5;
    const ev = await monitor.check(provider, closer, AT_1559_ET);
    expect(ev.map((e) => e.kind)).toContain('flat_by_close');
    expect(monitor.positions().length).toBe(0);
  });
});
