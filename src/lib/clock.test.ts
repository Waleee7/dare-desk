import { describe, it, expect } from 'vitest';
import { inLunchWindow, inMarketHours, etTimeString } from './clock.js';

// 2026-07-01 is a Wednesday; July is EDT (UTC-4). 16:00Z = 12:00 ET.
describe('clock (America/New_York)', () => {
  it('inLunchWindow true at noon ET, false at 10am ET', () => {
    expect(inLunchWindow(new Date('2026-07-01T16:00:00Z'), 690, 810)).toBe(true);  // 12:00 ET
    expect(inLunchWindow(new Date('2026-07-01T14:00:00Z'), 690, 810)).toBe(false); // 10:00 ET
  });
  it('inMarketHours true midday weekday, false Saturday', () => {
    expect(inMarketHours(new Date('2026-07-01T16:00:00Z'))).toBe(true);  // Wed 12:00 ET
    expect(inMarketHours(new Date('2026-07-04T16:00:00Z'))).toBe(false); // Sat
  });
  it('etTimeString formats HH:MM:SS', () => {
    expect(etTimeString(new Date('2026-07-01T16:00:00Z'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
