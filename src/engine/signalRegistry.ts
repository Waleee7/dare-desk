// Signal registry — the anti-spam / anti-chase memory. State-based detectors
// (momentum, breakout, gap-and-go) stay true while the condition holds, so the
// scanner re-emits the same move every tick; without this, the engine re-fires
// one move at progressively worse entries and floods the watch feed with
// duplicates — and every duplicate pollutes expectancy as an "independent" trade.
//
// Rules:
//   - a FIRE (A/A+) for ticker:setup:direction locks re-fires for
//     config.risk.refireCooldownMin unless the grade UPGRADED (A → A+)
//   - while a position is ON for ticker:direction, nothing re-fires there
//   - a WATCH (B) for the same key posts at most once per hour

import type { Grade } from '../lib/types.js';
import { config } from '../lib/config.js';

const RANK: Record<Grade, number> = { 'A+': 5, A: 4, B: 3, C: 2, D: 1 };
const WATCH_REPEAT_MS = 60 * 60_000;

export class SignalRegistry {
  private fired = new Map<string, { at: number; grade: Grade }>();
  private watched = new Map<string, number>();
  private on = new Set<string>(); // `${ticker}:${direction}` with a live position

  static key(ticker: string, setup: string, direction: string): string {
    return `${ticker.toUpperCase()}:${setup.toLowerCase()}:${direction}`;
  }

  /** Would this FIRE be a duplicate? Returns the block reason, or null to allow
   *  (and records it as the latest fire). */
  considerFire(ticker: string, setup: string, direction: string, grade: Grade, now = Date.now()): string | null {
    const onKey = `${ticker.toUpperCase()}:${direction}`;
    if (this.on.has(onKey)) return `duplicate_signal (position already on ${onKey})`;

    const key = SignalRegistry.key(ticker, setup, direction);
    const prev = this.fired.get(key);
    const lockMs = config.risk.refireCooldownMin * 60_000;
    if (prev && now - prev.at < lockMs && RANK[grade] <= RANK[prev.grade]) {
      const left = Math.ceil((prev.at + lockMs - now) / 60_000);
      return `duplicate_signal (same setup fired ${Math.round((now - prev.at) / 60_000)}m ago, ${left}m lock, no grade upgrade)`;
    }
    this.fired.set(key, { at: now, grade });
    return null;
  }

  /** Would this WATCH be a repeat? Returns the block reason, or null to allow. */
  considerWatch(ticker: string, setup: string, direction: string, now = Date.now()): string | null {
    const key = SignalRegistry.key(ticker, setup, direction);
    const prev = this.watched.get(key);
    if (prev != null && now - prev < WATCH_REPEAT_MS) {
      return `duplicate_watch (same watch posted ${Math.round((now - prev) / 60_000)}m ago)`;
    }
    this.watched.set(key, now);
    return null;
  }

  markOpen(ticker: string, direction: string): void {
    this.on.add(`${ticker.toUpperCase()}:${direction}`);
  }

  markClosed(ticker: string, direction: string): void {
    this.on.delete(`${ticker.toUpperCase()}:${direction}`);
  }
}
