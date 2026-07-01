// Calendar layer — macro/economic events + earnings. Feeds marketContext's
// eventRiskToday (a high-impact macro print today) and earningsSoon (a ticker
// reporting today/tomorrow). Free sources only; providers NEVER throw — they
// key-guard, time out at 4s, and return [] / empty Set on any error.

export interface CalendarEvent {
  date: string; // ISO day 'YYYY-MM-DD' the event lands on
  title: string; // e.g. 'CPI m/m', 'FOMC Rate Decision', 'Nonfarm Payrolls'
  impact: 'high' | 'medium' | 'low';
}

export interface CalendarProvider {
  name: string;
  /** Upcoming macro/economic events (best-effort window). Never throws → []. */
  macroEvents(): Promise<CalendarEvent[]>;
  /** Subset of `tickers` reporting earnings today/tomorrow. Never throws → empty Set. */
  earningsFor(tickers: string[]): Promise<Set<string>>;
}

/** True if any HIGH-impact event is dated today (compares the YYYY-MM-DD prefix
 *  of both sides, so a full ISO timestamp for `todayIso` is fine). */
export function hasHighImpactToday(events: CalendarEvent[], todayIso: string): boolean {
  const today = todayIso.slice(0, 10);
  return events.some((e) => e.impact === 'high' && e.date.slice(0, 10) === today);
}
