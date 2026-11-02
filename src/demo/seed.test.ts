import { describe, it, expect } from 'vitest';
import { buildDemoState, DEMO_PHASES } from './seed.js';

const NOW = Date.UTC(2026, 10, 2, 16, 0, 0); // Mon 2026-11-02 11:00 ET

describe('demo seed', () => {
  it('is deterministic: same inputs -> identical state', () => {
    const a = buildDemoState({ seed: 7, tick: 3, now: NOW });
    const b = buildDemoState({ seed: 7, tick: 3, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('accepts a Date and an epoch the same way', () => {
    expect(buildDemoState({ now: new Date(NOW) })).toEqual(buildDemoState({ now: NOW }));
  });
  it('a different seed changes the charts; a different tick does not', () => {
    const base = buildDemoState({ seed: 7, tick: 0, now: NOW });
    const seeded = buildDemoState({ seed: 8, tick: 0, now: NOW });
    const ticked = buildDemoState({ seed: 7, tick: 1, now: NOW });
    expect(seeded.intel!.SPY!.bars['5m']).not.toEqual(base.intel!.SPY!.bars['5m']);
    expect(ticked.intel!.SPY!.bars['5m']).toEqual(base.intel!.SPY!.bars['5m']);
  });
  it('is flagged demo and can never claim live trading or a live provider', () => {
    const s = buildDemoState({ now: NOW });
    expect(s.demo).toBe(true);
    expect(s.provider).toContain('demo');
    expect(s.meta.liveTrading).toBe(false);
    expect(s.proveIt.proven).toBe(false); // 12 of 100 — the gate stays honestly closed
    expect(s.proveIt.paperTrades).toBeLessThan(s.proveIt.needed);
  });
  it('has meaningful content on every tab', () => {
    const s = buildDemoState({ now: NOW });
    expect(s.positions!.length).toBeGreaterThanOrEqual(2);
    expect(s.armed!.length).toBeGreaterThanOrEqual(1);
    expect(s.closedTrades!.length).toBeGreaterThanOrEqual(10);
    expect(s.news!.length).toBeGreaterThan(0);
    expect(Object.keys(s.intel!).length).toBeGreaterThanOrEqual(10);
    expect(s.signals.some((x) => x.fired)).toBe(true);
    expect(s.signals.some((x) => !x.fired && x.blocks.length > 0 && (x.grade === 'A' || x.grade === 'A+'))).toBe(true);
  });
  it('bars are ascending, well-formed OHLC, and end at the quoted price', () => {
    const s = buildDemoState({ now: NOW });
    for (const t of Object.values(s.intel!)) {
      for (const tf of ['5m', '1h', '1D'] as const) {
        const bars = t.bars[tf];
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i]!;
          expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c) - 0.011);
          expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c) + 0.011);
          if (i) expect(b.t).toBeGreaterThan(bars[i - 1]!.t);
        }
      }
      expect(t.bars['5m'].at(-1)!.c).toBeCloseTo(t.price!, 1);
    }
  });
  it('scripts the scenario: ARMED at phase 2, a new fire + position at phase 4, loops at 6', () => {
    const at = (tick: number) => buildDemoState({ now: NOW, tick });
    expect(at(1).armed).toHaveLength(1);
    expect(at(2).armed).toHaveLength(2);
    expect(at(3).positions).toHaveLength(2);
    expect(at(4).positions).toHaveLength(3);
    expect(at(4).signals.filter((x) => x.fired)).toHaveLength(3);
    expect(at(DEMO_PHASES).armed).toHaveLength(1);
  });
  it('keeps the books internally consistent', () => {
    const s = buildDemoState({ now: NOW, tick: 4 });
    expect(s.day!.openPositionsCount).toBe(s.positions!.length);
    expect(s.expectancy.trades).toBe(s.closedTrades!.length);
    expect(s.summary.total).toBe(s.journal.length);
    const r = s.closedTrades!.reduce((a, t) => a + t.rMultiple, 0) / s.closedTrades!.length;
    expect(s.expectancy.expectancyR).toBeCloseTo(r, 2);
    for (const t of s.closedTrades!) expect(Math.sign(t.pnlUsd)).toBe(Math.sign(t.rMultiple));
    // open risk never exceeds the 3% account cap the firewall enforces
    expect(s.day!.openRiskUsd).toBeLessThanOrEqual(s.meta.accountSizeUsd * 0.03);
  });
});
