import { describe, it, expect } from 'vitest';
import { swingLevels, volumeNodes, computeKeyLevels, snapTargets } from './levels.js';
import type { Bar } from '../data/provider.js';
import type { KeyLevels } from '../lib/types.js';

const bar = (o: number, h: number, l: number, c: number, v = 1_000_000, t = 0): Bar =>
  ({ t, o, h, l, c, v });

/** Flat tape with one clear swing high at 105 and one swing low at 95. */
function structuredBars(): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) {
    if (i === 8) bars.push(bar(100, 105, 99, 100));      // pivot high
    else if (i === 14) bars.push(bar(100, 101, 95, 100)); // pivot low
    else bars.push(bar(100, 101, 99, 100));
  }
  return bars;
}

describe('swingLevels', () => {
  it('finds the pivot high and low', () => {
    const { highs, lows } = swingLevels(structuredBars());
    expect(highs).toContain(105);
    expect(lows).toContain(95);
  });
  it('handles short input without pivots', () => {
    const { highs, lows } = swingLevels([bar(1, 2, 0.5, 1)]);
    expect(highs).toEqual([]);
    expect(lows).toEqual([]);
  });
});

describe('volumeNodes', () => {
  it('surfaces the price area where volume concentrated', () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(100, 101, 99, 100, 500_000));
    for (let i = 0; i < 10; i++) bars.push(bar(110, 111, 109, 110, 5_000_000)); // heavy node ~110
    const nodes = volumeNodes(bars, 24, 2);
    expect(nodes.length).toBeGreaterThan(0);
    expect(Math.abs(nodes[0]! - 110)).toBeLessThan(2);
  });
  it('returns empty on flat/insufficient data', () => {
    expect(volumeNodes([bar(1, 1, 1, 1)])).toEqual([]);
  });
});

describe('computeKeyLevels', () => {
  it('splits levels around price and carries walls through', () => {
    const daily = [bar(98, 106, 94, 100), bar(100, 104, 96, 102), bar(102, 103, 100, 101)];
    const lv = computeKeyLevels({
      ticker: 'TEST', price: 100, intraday: structuredBars(), daily,
      chain: {
        ticker: 'TEST', delayed: true, asOf: '', spot: 100, expiry: null, expirations: [], quotes: [],
        unusualStrikes: [], highestVolumeStrikes: [],
        putCallVolRatio: null, gammaMagnets: [103], callWall: 105, putWall: 95,
        netFlowBias: 'mixed', note: '',
      },
    });
    expect(lv.callWall).toBe(105);
    expect(lv.putWall).toBe(95);
    expect(lv.resistance.every((r) => r > 100)).toBe(true);
    expect(lv.support.every((s) => s < 100)).toBe(true);
    expect(lv.prevDayHigh).toBe(104); // prior day = second-to-last daily bar
  });
});

describe('snapTargets', () => {
  const levels = (resistance: number[], support: number[]): KeyLevels => ({
    ticker: 'TEST', asOf: '', price: 100, support, resistance, volumeNodes: [],
    callWall: null, putWall: null, gammaMagnets: [],
    prevDayHigh: null, prevDayLow: null, prevClose: null,
  });

  it('pulls a long target to just under the wall in its path', () => {
    const [t] = snapTargets(100, [104], 'long', levels([103], []));
    expect(t!).toBeLessThan(103);
    expect(t!).toBeGreaterThan(100);
  });
  it('pulls a short target to just over the support wall', () => {
    const [t] = snapTargets(100, [96], 'short', levels([], [97]));
    expect(t!).toBeGreaterThan(97);
    expect(t!).toBeLessThan(100);
  });
  it('leaves targets alone when no wall is in the path', () => {
    expect(snapTargets(100, [104], 'long', levels([110], []))).toEqual([104]);
    expect(snapTargets(100, [104], 'long', levels([], []))).toEqual([104]);
  });
  it('never snaps a target back through the entry', () => {
    const [t] = snapTargets(100, [101], 'long', levels([100.02], []));
    expect(t!).toBeGreaterThan(100);
  });
});
