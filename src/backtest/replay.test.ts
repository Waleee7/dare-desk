import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplayMarketDataProvider } from './replayProvider.js';
import { synthHistory } from './history.js';
import { runBacktest } from './runner.js';
import { setClockNow } from '../lib/clock.js';
import type { Bar } from '../data/provider.js';

afterAll(() => setClockNow(null)); // never leave the clock frozen for other suites

describe('ReplayMarketDataProvider — no lookahead', () => {
  const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({
    t: 1_000 + i * 60_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000,
  }));
  const p = new ReplayMarketDataProvider({ SPY: { '1Min': bars } });

  it('returns nothing before the first bar', async () => {
    p.setNow(0);
    expect((await p.getBars('SPY', '1Min', 100)).length).toBe(0);
  });

  it('returns only bars at or before the virtual clock', async () => {
    p.setNow(1_000 + 4 * 60_000); // through the 5th bar (index 4)
    const got = await p.getBars('SPY', '1Min', 100);
    expect(got.length).toBe(5);
    expect(got[got.length - 1]!.t).toBeLessThanOrEqual(p.now());
    // The definitive check: NO returned bar is in the future.
    expect(got.every((b) => b.t <= p.now())).toBe(true);
  });

  it('respects the limit (most-recent slice)', async () => {
    p.setNow(1_000 + 9 * 60_000);
    const got = await p.getBars('SPY', '1Min', 3);
    expect(got.length).toBe(3);
    expect(got[2]!.t).toBe(1_000 + 9 * 60_000);
  });

  it('quote = close of the latest available bar', async () => {
    p.setNow(1_000 + 6 * 60_000);
    const q = await p.getQuote('SPY');
    expect(q.price).toBe(bars[6]!.c);
  });

  it('never leaks a future bar across the whole span', async () => {
    for (let t = 0; t <= 1_000 + 10 * 60_000; t += 30_000) {
      p.setNow(t);
      const got = await p.getBars('SPY', '1Min', 100);
      expect(got.every((b) => b.t <= t)).toBe(true);
    }
  });
});

describe('synthHistory', () => {
  it('produces consistent multi-timeframe history', () => {
    const store = synthHistory({ symbols: ['SPY'], days: 3, endDate: '2026-06-26' });
    expect(store.SPY!['1Min']!.length).toBe(3 * 390);
    expect(store.SPY!['1Day']!.length).toBe(3); // one daily bar per session
    // Aggregated 5-min bars roll up the 1-min volume exactly (no bars dropped).
    const oneMinVol = store.SPY!['1Min']!.reduce((s, b) => s + b.v, 0);
    const fiveMinVol = store.SPY!['5Min']!.reduce((s, b) => s + b.v, 0);
    expect(fiveMinVol).toBe(oneMinVol);
    // Ascending by time.
    const t = store.SPY!['1Min']!;
    expect(t.every((b, i) => i === 0 || b.t > t[i - 1]!.t)).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const a = synthHistory({ symbols: ['NVDA'], days: 2, endDate: '2026-06-26', seed: 7 });
    const b = synthHistory({ symbols: ['NVDA'], days: 2, endDate: '2026-06-26', seed: 7 });
    expect(a.NVDA!['1Min']![100]!.c).toBe(b.NVDA!['1Min']![100]!.c);
  });
});

describe('runBacktest — end to end through the live pipeline', () => {
  it('replays synthetic history and produces closed trades + expectancy', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'bt-'));
    const store = synthHistory({ symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD'], days: 30, endDate: '2026-06-26' });
    // Include the watch line so the harness's open→close→expectancy path is
    // exercised even though strict A-grade fires are rare on heuristic-only data.
    const report = await runBacktest({ store, stepMinutes: 15, sandboxDir: sandbox, fireGrades: ['A+', 'A', 'B'] });

    expect(report.ticks).toBeGreaterThan(0);
    expect(report.scannedDays).toBeGreaterThan(0);
    expect(report.closed.length).toBeGreaterThan(0); // the exit monitor actually closed trades
    // Expectancy math is finite and internally consistent.
    expect(Number.isFinite(report.expectancy.expectancyR)).toBe(true);
    expect(report.expectancy.trades).toBe(report.closed.length);
    // Every closed trade has a real R multiple and a win/loss verdict.
    expect(report.closed.every((t) => Number.isFinite(t.rMultiple) && (t.result === 'win' || t.result === 'loss'))).toBe(true);
    // The clock was released (a later new Date() is real, not frozen in 2026-06).
    expect(Math.abs(Date.now() - new Date('2026-06-26').getTime())).toBeGreaterThan(86_400_000);
  }, 30_000);
});
