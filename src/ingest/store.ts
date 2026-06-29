// Raw alert store. In-memory for v1; swap for a real store in Phase 2 (the
// trading-signal-forensics skill consumes this history to grade the bot).

import type { RawAlert } from '../lib/types.js';

const alerts: RawAlert[] = [];

export function storeRawAlert(a: RawAlert): void {
  alerts.push(a);
}

export function allRawAlerts(): readonly RawAlert[] {
  return alerts;
}

export function makeRawAlert(text: string, source = 'schwab-alerts'): RawAlert {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    text: text.trim(),
    receivedAt: new Date().toISOString(),
  };
}
