import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PremiumFloorEngine } from '../pipeline.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'pf-day-'));

describe('day persistence + rollover', () => {
  it('persists day state and reloads it on restart', () => {
    const dir = tmp();
    const eng = new PremiumFloorEngine({ dataDir: dir });
    eng.dayState().realizedPnlUsd = -150;
    eng.dayState().peakPnlUsd = 40;
    // closeTrade persists; poke persistence directly via a close
    eng.closeTrade({
      ticker: 'NVDA', direction: 'long', setup: 't', tier: 'focus',
      entryTimeEt: '10:00:00', exitTimeEt: '10:30:00',
      fillPremium: 2, exitPremium: 1.5, contracts: 1, costPaidUsd: 200, stopPremium: 1.3,
      regime: 'up',
    });
    const reloaded = new PremiumFloorEngine({ dataDir: dir });
    expect(reloaded.dayState().realizedPnlUsd).toBeLessThan(0); // the loss survived the restart
    expect(reloaded.journal.expectancy().trades).toBe(1); // prove-it counter survives too
  });

  it('rolls the day, archives history, and trips the weekly breaker', () => {
    const dir = tmp();
    const eng = new PremiumFloorEngine({ dataDir: dir });
    // Fake a brutal yesterday: -7% on a $10k account (> the 6% weekly cap alone).
    eng.dayState().date = '2026-06-30';
    eng.dayState().realizedPnlUsd = -700;
    eng.rollDay();
    expect(eng.dayState().realizedPnlUsd).toBe(0); // fresh day
    expect(eng.dayHistory().some((d) => d.date === '2026-06-30')).toBe(true);
    expect(eng.dayState().standDownReason).toContain('weekly breaker');
  });

  it('half-sizes after a red-day streak', () => {
    const dir = tmp();
    const eng = new PremiumFloorEngine({ dataDir: dir });
    for (const [date, pnl] of [['2026-06-25', -50], ['2026-06-26', -80], ['2026-06-29', -30]] as const) {
      eng.dayState().date = date;
      eng.dayState().realizedPnlUsd = pnl;
      eng.rollDay();
    }
    expect(eng.dayState().sizeMultiplier).toBe(0.5);
    expect(eng.dayState().standDownReason).toBeNull(); // -160 total: streak yes, breaker no
  });

  it('rebuilds aggregate exposure from persisted positions', () => {
    const dir = tmp();
    const eng = new PremiumFloorEngine({ dataDir: dir });
    eng.syncOpenPositions([
      { ticker: 'NVDA', direction: 'long', fillPremium: 2.5, stopPremium: 1.5, contracts: 1, costPaidUsd: 250 },
      { ticker: 'QQQ', direction: 'long', fillPremium: 1.3, stopPremium: 0.8, contracts: 1, costPaidUsd: 130 },
    ] as never[]);
    expect(eng.dayState().openPositionsCount).toBe(2);
    // At-stop risk w/ 1.25 gap haircut: (1.0×100×1.25) + (0.5×100×1.25) = 188
    expect(eng.dayState().openRiskUsd).toBe(188);
    expect(eng.dayState().openClusters['semis-nasdaq:long']).toBe(2); // NVDA + QQQ share a cluster
  });
});
