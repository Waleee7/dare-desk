// Single source of America/New_York clock truth. The bot's discipline — lunch
// suppression, 0DTE flat-by, entry-ticket timestamps, EOD recap — all key off ET.
// Extracted here so firewall / broker / alert / recap share ONE timezone source
// instead of each re-deriving it (run.ts used to own this inline).

const ET = 'America/New_York';

// --- Injectable clock ------------------------------------------------------------
// The backtest replays history through the LIVE pipeline, so every wall-clock gate
// (market hours, lunch suppression, 0DTE windows, entry timestamps, EOD) must read
// "virtual now", not the real time. clock.ts is the single source of ET truth, so
// freezing it here propagates everywhere. Null = live (real clock). Only the
// backtest process ever sets this; the live runner never touches it.
let frozenNowMs: number | null = null;

/** Freeze the clock at `ms` (backtest replay), or pass null to return to live time. */
export function setClockNow(ms: number | null): void { frozenNowMs = ms; }

/** The engine's current instant — frozen during replay, real otherwise. */
export function clockNow(): Date { return frozenNowMs != null ? new Date(frozenNowMs) : new Date(); }

/** True during a backtest replay. Live-network fetches (Fear&Greed, delayed
 *  option chains, LLM scoring) skip when frozen: they'd return TODAY's data for a
 *  historical bar, and they'd make replay slow, costly, and non-deterministic. */
export function isClockFrozen(): boolean { return frozenNowMs != null; }

/** "Now" projected into ET wall-clock (a Date whose local fields read as ET). */
export function nowEt(now: Date = clockNow()): Date {
  return new Date(now.toLocaleString('en-US', { timeZone: ET }));
}

/** HH:MM:SS in ET, 24h — e.g. "09:31:07". Used for entry-ticket timestamps. */
export function etTimeString(now: Date = clockNow()): string {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
  return s.replace(/^24/, '00'); // some engines print 24 at midnight
}

/** Minutes past ET midnight (9:30 → 570, 16:00 → 960). */
export function etMinutes(now: Date = clockNow()): number {
  const et = nowEt(now);
  return et.getHours() * 60 + et.getMinutes();
}

/** Is ET now inside the given lunch-chop window [startMin, endMin)? */
export function inLunchWindow(now: Date, startMin: number, endMin: number): boolean {
  const m = etMinutes(now);
  return m >= startMin && m < endMin;
}

/** US regular trading hours: Mon–Fri 9:30–16:00 ET. */
export function inMarketHours(now: Date = clockNow()): boolean {
  const et = nowEt(now);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 570 && m < 960; // 9:30 → 16:00
}
