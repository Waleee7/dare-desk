import { describe, it, expect } from 'vitest';
import { classifyTrend, htfAgrees, fightsHtf, trendLine } from './trend.js';
import type { TrendSnapshot, TimeframeTrend, TrendDir } from '../lib/types.js';

const rising = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
const falling = Array.from({ length: 40 }, (_, i) => 120 - i * 0.5);
const chop = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 0.3 : -0.3));

const tf = (label: TimeframeTrend['label'], dir: TrendDir): TimeframeTrend =>
  ({ label, dir, emaFast: null, emaSlow: null, rsi: null, pctFromEmaSlow: null });

const snap = (dirs: [TrendDir, TrendDir, TrendDir, TrendDir]): TrendSnapshot => {
  const ups = dirs.filter((d) => d === 'up').length;
  const downs = dirs.filter((d) => d === 'down').length;
  return {
    ticker: 'TEST',
    asOf: new Date().toISOString(),
    timeframes: [tf('15m', dirs[0]), tf('1h', dirs[1]), tf('4h', dirs[2]), tf('1D', dirs[3])],
    alignment: ups >= 3 && downs === 0 ? 'aligned-up' : downs >= 3 && ups === 0 ? 'aligned-down' : 'mixed',
    alignScore: ups - downs,
  };
};

describe('classifyTrend', () => {
  it('reads a steady climb as up', () => expect(classifyTrend(rising)).toBe('up'));
  it('reads a steady slide as down', () => expect(classifyTrend(falling)).toBe('down'));
  it('reads chop as flat', () => expect(classifyTrend(chop)).toBe('flat'));
  it('reads insufficient data as flat', () => expect(classifyTrend([100, 101])).toBe('flat'));
});

describe('htfAgrees / fightsHtf', () => {
  it('agrees when >=2 TFs point with the trade and none against', () => {
    expect(htfAgrees(snap(['up', 'up', 'flat', 'flat']), 'long')).toBe(true);
    expect(htfAgrees(snap(['down', 'down', 'down', 'flat']), 'short')).toBe(true);
  });
  it('does not agree when a TF points against', () => {
    expect(htfAgrees(snap(['up', 'up', 'down', 'flat']), 'long')).toBe(false);
  });
  it('does not agree with only one supporting TF', () => {
    expect(htfAgrees(snap(['up', 'flat', 'flat', 'flat']), 'long')).toBe(false);
  });
  it('flags a long fighting an aligned-down stack (the 0/10 pattern)', () => {
    expect(fightsHtf(snap(['down', 'down', 'down', 'flat']), 'long')).toBe(true);
    expect(fightsHtf(snap(['down', 'down', 'down', 'flat']), 'short')).toBe(false);
  });
  it('mixed stacks fight nothing', () => {
    expect(fightsHtf(snap(['up', 'down', 'flat', 'up']), 'long')).toBe(false);
  });
});

describe('trendLine', () => {
  it('renders arrows + alignment tag', () => {
    const line = trendLine(snap(['up', 'up', 'up', 'flat']));
    expect(line).toContain('15m↑');
    expect(line).toContain('1D→');
    expect(line).toContain('ALIGNED UP');
  });
});
