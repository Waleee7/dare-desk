import { describe, it, expect, vi } from 'vitest';
import {
  haptic, canVibrate, PATTERNS, readHapticsPref, writeHapticsPref, prefersReducedMotion, HAPTICS_KEY,
} from './haptics';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const motion = (reduce: boolean) => ({ matchMedia: () => ({ matches: reduce }) });

describe('haptic()', () => {
  it('is a safe no-op with no navigator (SSR / node)', () => {
    expect(haptic('signal', { nav: null })).toBe(false);
    expect(haptic('signal')).toBe(false); // node has no global navigator vibrate
  });
  it('is a safe no-op when vibrate is missing (iOS Safari)', () => {
    expect(canVibrate({})).toBe(false);
    expect(haptic('armed', { nav: {} })).toBe(false);
  });
  it('never throws when vibrate throws', () => {
    const nav = { vibrate: () => { throw new Error('NotAllowedError'); } };
    expect(() => haptic('tap', { nav })).not.toThrow();
    expect(haptic('tap', { nav })).toBe(false);
  });
  it('does nothing when disabled, even if supported', () => {
    const vibrate = vi.fn(() => true);
    expect(haptic('signal', { nav: { vibrate }, enabled: false })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('sends the right pattern and reports acceptance', () => {
    const vibrate = vi.fn(() => true);
    expect(haptic('armed', { nav: { vibrate } })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(PATTERNS.armed);
    // browsers return false when they refuse (no user gesture yet)
    expect(haptic('armed', { nav: { vibrate: () => false } })).toBe(false);
  });
  it('keeps every pattern short and non-empty', () => {
    for (const p of Object.values(PATTERNS)) {
      const total = ([] as number[]).concat(p).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(300);
    }
  });
});

describe('haptics preference', () => {
  it('defaults ON, but OFF under prefers-reduced-motion', () => {
    expect(readHapticsPref(mem(), motion(false))).toBe(true);
    expect(readHapticsPref(mem(), motion(true))).toBe(false);
  });
  it('a saved choice beats the default in both directions', () => {
    expect(readHapticsPref(mem({ [HAPTICS_KEY]: 'on' }), motion(true))).toBe(true);
    expect(readHapticsPref(mem({ [HAPTICS_KEY]: 'off' }), motion(false))).toBe(false);
  });
  it('round-trips through storage', () => {
    const s = mem();
    writeHapticsPref(false, s);
    expect(readHapticsPref(s, motion(false))).toBe(false);
    writeHapticsPref(true, s);
    expect(readHapticsPref(s, motion(true))).toBe(true);
  });
  it('survives blocked storage and a broken matchMedia', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => writeHapticsPref(true, boom)).not.toThrow();
    expect(readHapticsPref(boom, motion(false))).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error('x'); } })).toBe(false);
  });
});
