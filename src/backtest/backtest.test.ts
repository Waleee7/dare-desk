import { describe, it, expect } from 'vitest';
import { applyRealisticFill, computeExpectancy, claimsAllowed } from './index.js';
import type { ClosedTrade } from '../lib/types.js';

describe('applyRealisticFill', () => {
  it('fills worse than mid and adds commission', () => {
    const f = applyRealisticFill(1.0, 2);
    expect(f.fillPremium).toBeGreaterThan(1.0); // crossed half spread + slippage
    expect(f.costPerContractUsd).toBeCloseTo(f.fillPremium * 100, 2);
    expect(f.costPaidUsd).toBeGreaterThan(f.costPerContractUsd * 2); // + commission
    expect(f.slippageUsd).toBeGreaterThan(0);
  });
  it('never returns a zero/negative premium', () => {
    expect(applyRealisticFill(null, 1).fillPremium).toBeGreaterThan(0);
  });
});

function closed(over: Partial<ClosedTrade>): ClosedTrade {
  return {
    ticker: 'QQQ', setup: 't', tier: 'core', entryTimeEt: '09:30:00', exitTimeEt: '09:45:00',
    fillPremium: 1, exitPremium: 1.5, contracts: 1, costPaidUsd: 100, pnlUsd: 50, rMultiple: 1,
    holdMinutes: 15, result: 'win', regime: 'up', ...over,
  };
}

describe('computeExpectancy + prove-it gate', () => {
  it('empty → not proven, claims blocked', () => {
    const e = computeExpectancy([]);
    expect(e.trades).toBe(0);
    expect(e.proven).toBe(false);
    expect(claimsAllowed(e)).toBe(false);
  });
  it('positive expectancy but small sample stays unproven (needs >=100 trades)', () => {
    const e = computeExpectancy([
      closed({ rMultiple: 2, result: 'win', pnlUsd: 100 }),
      closed({ rMultiple: -1, result: 'loss', pnlUsd: -50 }),
    ]);
    expect(e.trades).toBe(2);
    expect(e.expectancyR).toBeCloseTo(0.5, 5);
    expect(e.proven).toBe(false);
    expect(claimsAllowed(e)).toBe(false);
  });
  it('computes win rate + profit factor', () => {
    const e = computeExpectancy([
      closed({ result: 'win', pnlUsd: 100, rMultiple: 2 }),
      closed({ result: 'loss', pnlUsd: -50, rMultiple: -1 }),
    ]);
    expect(e.winRate).toBe(0.5);
    expect(e.profitFactor).toBeCloseTo(2, 5);
  });
});
