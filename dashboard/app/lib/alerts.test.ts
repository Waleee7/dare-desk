import { describe, it, expect } from 'vitest';
import { buildDemoState } from '../../../src/demo/seed';
import type { DashboardState } from './types';
import { detectNewAlerts, hapticFor } from './alerts';

const NOW = Date.UTC(2026, 10, 2, 16, 0, 0);
const at = (tick: number) => buildDemoState({ now: NOW, tick }) as unknown as DashboardState;

describe('detectNewAlerts', () => {
  it('never alerts on the first load', () => {
    expect(detectNewAlerts(null, at(5))).toEqual({ armed: [], signals: [] });
  });
  it('is quiet when nothing changed', () => {
    expect(hapticFor(detectNewAlerts(at(0), at(1)))).toBeNull();
  });
  it('flags the ARMED alert that appears at phase 2', () => {
    const n = detectNewAlerts(at(1), at(2));
    expect(n.armed).toHaveLength(1);
    expect(n.armed[0]).toContain('TSLA');
    expect(hapticFor(n)).toBe('armed');
  });
  it('flags the newly fired signal at phase 4 and prefers it over ARMED', () => {
    const n = detectNewAlerts(at(3), at(4));
    expect(n.signals).toHaveLength(1);
    expect(n.signals[0]).toContain('GOOGL');
    expect(hapticFor(n)).toBe('signal');
  });
  it('does not re-alert for an alert that is already showing', () => {
    expect(detectNewAlerts(at(4), at(5))).toEqual({ armed: [], signals: [] });
  });
});
