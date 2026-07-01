// Single source of America/New_York clock truth. The bot's discipline — lunch
// suppression, 0DTE flat-by, entry-ticket timestamps, EOD recap — all key off ET.
// Extracted here so firewall / broker / alert / recap share ONE timezone source
// instead of each re-deriving it (run.ts used to own this inline).

const ET = 'America/New_York';

/** "Now" projected into ET wall-clock (a Date whose local fields read as ET). */
export function nowEt(now: Date = new Date()): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: ET }));
}

/** HH:MM:SS in ET, 24h — e.g. "09:31:07". Used for entry-ticket timestamps. */
export function etTimeString(now: Date = new Date()): string {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
  return s.replace(/^24/, '00'); // some engines print 24 at midnight
}

/** Minutes past ET midnight (9:30 → 570, 16:00 → 960). */
export function etMinutes(now: Date = new Date()): number {
  const et = nowEt(now);
  return et.getHours() * 60 + et.getMinutes();
}

/** Is ET now inside the given lunch-chop window [startMin, endMin)? */
export function inLunchWindow(now: Date, startMin: number, endMin: number): boolean {
  const m = etMinutes(now);
  return m >= startMin && m < endMin;
}

/** US regular trading hours: Mon–Fri 9:30–16:00 ET. */
export function inMarketHours(now: Date = new Date()): boolean {
  const et = nowEt(now);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 570 && m < 960; // 9:30 → 16:00
}
