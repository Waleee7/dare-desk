import { describe, it, expect } from 'vitest';
import { tierOf } from './universe.js';

describe('tierOf', () => {
  it('Core = SPY/QQQ', () => {
    expect(tierOf('SPY')).toBe('core');
    expect(tierOf('QQQ')).toBe('core');
  });
  it('Focus = mag7 + semis (incl SMH)', () => {
    expect(tierOf('NVDA')).toBe('focus');
    expect(tierOf('AAPL')).toBe('focus');
    expect(tierOf('SMH')).toBe('focus');
    expect(tierOf('AMD')).toBe('focus');
  });
  it('Extended = everything else', () => {
    expect(tierOf('PLTR')).toBe('extended');
    expect(tierOf('F')).toBe('extended');
  });
  it('is case-insensitive', () => {
    expect(tierOf('spy')).toBe('core');
    expect(tierOf('nvda')).toBe('focus');
  });
});
