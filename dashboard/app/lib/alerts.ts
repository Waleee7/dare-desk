// New-alert detection. Compares two polled states and reports which ARMED
// pre-trigger alerts and which fired A+/A signals are NEW since the last poll.
// The very first state (prev === null) never alerts — loading the page is not news.

import type { ArmedSignal, DashboardState, SignalRow } from './types';
import type { HapticKind } from './haptics';

export const armedKey = (a: Pick<ArmedSignal, 'ticker' | 'direction' | 'triggerLevel'>): string =>
  `armed|${a.ticker}|${a.direction}|${a.triggerLevel}`;

export const signalKey = (s: Pick<SignalRow, 'ticker' | 'setup' | 'contract'>): string =>
  `sig|${s.ticker}|${s.setup}|${s.contract}`;

export const isFiredAlert = (s: SignalRow): boolean => s.fired && (s.grade === 'A+' || s.grade === 'A');

export interface NewAlerts { armed: string[]; signals: string[] }

export function detectNewAlerts(prev: DashboardState | null, next: DashboardState): NewAlerts {
  if (!prev) return { armed: [], signals: [] };
  const prevArmed = new Set((prev.armed ?? []).map(armedKey));
  const prevSigs = new Set(prev.signals.filter(isFiredAlert).map(signalKey));
  return {
    armed: (next.armed ?? []).map(armedKey).filter((k) => !prevArmed.has(k)),
    signals: next.signals.filter(isFiredAlert).map(signalKey).filter((k) => !prevSigs.has(k)),
  };
}

/** Strongest pattern wins: a fired signal outranks an ARMED heads-up. */
export function hapticFor(n: NewAlerts): HapticKind | null {
  if (n.signals.length) return 'signal';
  if (n.armed.length) return 'armed';
  return null;
}
