import { describe, it, expect } from 'vitest';
import { rvolFromDaily, barSurge } from './volume.js';

const days = (vols: number[]) => vols.map((v) => ({ v }));

describe('rvolFromDaily', () => {
  it('reads 1.0 when today matches the average pace', () => {
    // 20 prior days at 1M, today 500k at half the session = exactly average pace.
    const d = days([...Array.from({ length: 20 }, () => 1_000_000), 500_000]);
    expect(rvolFromDaily(d, 0.5)).toBeCloseTo(1.0, 1);
  });
  it('reads hot when today runs 2x the pace', () => {
    const d = days([...Array.from({ length: 20 }, () => 1_000_000), 1_000_000]);
    expect(rvolFromDaily(d, 0.5)).toBeCloseTo(2.0, 1);
  });
  it('returns null without enough history', () => {
    expect(rvolFromDaily(days([1, 2, 3]), 0.5)).toBeNull();
  });
});

describe('barSurge', () => {
  it('fires when the latest bar runs >1.3x its 20-bar average', () => {
    const bars = [...Array.from({ length: 20 }, () => ({ v: 100 })), { v: 200 }];
    expect(barSurge(bars)).toBe(true);
  });
  it('stays quiet on a normal bar', () => {
    const bars = [...Array.from({ length: 20 }, () => ({ v: 100 })), { v: 110 }];
    expect(barSurge(bars)).toBe(false);
  });
  it('needs 21 bars of history', () => {
    expect(barSurge([{ v: 100 }, { v: 500 }])).toBe(false);
  });
});
