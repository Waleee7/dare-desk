import { describe, it, expect } from 'vitest';
import { detectArmed, armedKey, type ArmedInput } from './armed.js';
import type { TrendSnapshot, KeyLevels, VolumeStats, TrendDir } from '../lib/types.js';

const NOON = new Date('2026-07-01T16:00:00Z');

const trend = (alignment: TrendSnapshot['alignment']): TrendSnapshot => ({
  ticker: 'NVDA', asOf: '', timeframes: [], alignment,
  alignScore: alignment === 'aligned-up' ? 3 : alignment === 'aligned-down' ? -3 : 0,
});
const levels = (over: Partial<KeyLevels> = {}): KeyLevels => ({
  ticker: 'NVDA', asOf: '', price: 100, support: [98, 96], resistance: [100.1, 102],
  volumeNodes: [], callWall: null, putWall: null, gammaMagnets: [],
  prevDayHigh: null, prevDayLow: null, prevClose: null, ...over,
});
const rvol = (r: number | null): VolumeStats => ({ ticker: 'NVDA', rvol: r, lastBarSurge: false, note: '' });

const base: ArmedInput = {
  ticker: 'NVDA', price: 100, trend: trend('aligned-up'), levels: levels(),
  rvol: rvol(1.8), chain: { netFlowBias: 'bullish' },
};

describe('detectArmed — strongest plays only', () => {
  it('arms a long coiling just under resistance with trend + volume + flow', () => {
    const a = detectArmed(base, NOON);
    expect(a).not.toBeNull();
    expect(a!.direction).toBe('long');
    expect(a!.triggerLevel).toBe(100.1); // nearest resistance above price
    expect(a!.why).toContain('get ready');
  });

  it('arms a short coiling just above support on a stacked-down trend', () => {
    const a = detectArmed({ ...base, trend: trend('aligned-down'), price: 96.1,
      levels: levels({ support: [96, 94], resistance: [98, 100] }), chain: { netFlowBias: 'bearish' } }, NOON);
    expect(a!.direction).toBe('short');
    expect(a!.triggerLevel).toBe(96); // nearest support below price
  });

  it('does NOT arm on a mixed higher-timeframe trend', () => {
    expect(detectArmed({ ...base, trend: trend('mixed') }, NOON)).toBeNull();
  });

  it('does NOT arm on a dead tape (weak RVOL)', () => {
    expect(detectArmed({ ...base, rvol: rvol(1.0) }, NOON)).toBeNull();
  });

  it('does NOT arm when options flow fights the direction', () => {
    expect(detectArmed({ ...base, chain: { netFlowBias: 'bearish' } }, NOON)).toBeNull();
  });

  it('allows mixed flow (agreeing is ideal, neutral is acceptable)', () => {
    expect(detectArmed({ ...base, chain: { netFlowBias: 'mixed' } }, NOON)).not.toBeNull();
  });

  it('does NOT arm when price is too far from the trigger', () => {
    expect(detectArmed({ ...base, levels: levels({ resistance: [105, 110] }) }, NOON)).toBeNull();
  });

  it('does NOT arm without a trigger level in the break direction', () => {
    expect(detectArmed({ ...base, levels: levels({ resistance: [] }) }, NOON)).toBeNull();
  });

  it('needs price, trend, levels, and rvol', () => {
    expect(detectArmed({ ...base, price: null }, NOON)).toBeNull();
    expect(detectArmed({ ...base, trend: null }, NOON)).toBeNull();
    expect(detectArmed({ ...base, levels: null }, NOON)).toBeNull();
    expect(detectArmed({ ...base, rvol: rvol(null) }, NOON)).toBeNull();
  });
});

describe('armedKey', () => {
  it('is stable per ticker+direction+level (dedup) but differs across them', () => {
    const a = detectArmed(base, NOON)!;
    expect(armedKey(a)).toBe(armedKey(detectArmed(base, NOON)!));
    const shortSig = detectArmed({ ...base, trend: trend('aligned-down'), price: 96.1,
      levels: levels({ support: [96], resistance: [] }), chain: { netFlowBias: 'bearish' } }, NOON)!;
    expect(armedKey(a)).not.toBe(armedKey(shortSig));
  });
});
