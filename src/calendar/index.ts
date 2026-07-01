// Calendar provider factory. Macro/economic events come from FMP's economic
// calendar (feeds eventRiskToday); earnings come from FMP or Finnhub (feeds
// earningsSoon). Free sources only, key-guarded, never throws — returns a
// StubCalendar (empty results, name 'stub') when no keys are configured.

import type { CalendarEvent, CalendarProvider } from './provider.js';
import { config } from '../lib/config.js';

const TIMEOUT_MS = 4000;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const todayIso = (): string => isoDay(new Date());
const plusDaysIso = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

/** Map a raw provider impact label ('High'/'Medium'/'Low'/'3'/…) to our enum. */
export function newsWorthyImpact(raw: string | number | null | undefined): CalendarEvent['impact'] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.startsWith('high') || s === '3') return 'high';
  if (s.startsWith('med') || s === '2') return 'medium';
  return 'low';
}

interface FmpEconRow { event?: string; date?: string; country?: string; impact?: string }
interface FmpEarnRow { date?: string; symbol?: string }
interface FinnhubEarnResp { earningsCalendar?: { date?: string; symbol?: string }[] }

/** US macro/economic events for the next week from FMP. Never throws → []. */
async function fmpMacroEvents(): Promise<CalendarEvent[]> {
  if (!config.fmpKey) return [];
  const url =
    `https://financialmodelingprep.com/api/v3/economic_calendar` +
    `?from=${todayIso()}&to=${plusDaysIso(7)}&apikey=${config.fmpKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return []; // FMP returns an error object on bad key
    const out: CalendarEvent[] = [];
    for (const r of data as FmpEconRow[]) {
      if ((r.country ?? '').toUpperCase() !== 'US') continue; // US desk → US macro only
      const title = (r.event ?? '').trim();
      const date = (r.date ?? '').slice(0, 10);
      if (!title || !date) continue;
      out.push({ date, title, impact: newsWorthyImpact(r.impact) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Tickers (from `wanted`) with earnings today/tomorrow — via FMP. Never throws. */
async function fmpEarningsFor(wanted: Set<string>): Promise<Set<string>> {
  if (!config.fmpKey || wanted.size === 0) return new Set();
  const url =
    `https://financialmodelingprep.com/api/v3/earning_calendar` +
    `?from=${todayIso()}&to=${plusDaysIso(1)}&apikey=${config.fmpKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return new Set();
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return new Set();
    const hit = new Set<string>();
    for (const r of data as FmpEarnRow[]) {
      const sym = (r.symbol ?? '').toUpperCase();
      if (sym && wanted.has(sym)) hit.add(sym);
    }
    return hit;
  } catch {
    return new Set();
  }
}

/** Tickers (from `wanted`) with earnings today/tomorrow — via Finnhub. Never throws. */
async function finnhubEarningsFor(wanted: Set<string>): Promise<Set<string>> {
  if (!config.finnhubKey || wanted.size === 0) return new Set();
  const url =
    `https://finnhub.io/api/v1/calendar/earnings` +
    `?from=${todayIso()}&to=${plusDaysIso(1)}&token=${config.finnhubKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return new Set();
    const data = (await res.json()) as FinnhubEarnResp;
    const rows = Array.isArray(data.earningsCalendar) ? data.earningsCalendar : [];
    const hit = new Set<string>();
    for (const r of rows) {
      const sym = (r.symbol ?? '').toUpperCase();
      if (sym && wanted.has(sym)) hit.add(sym);
    }
    return hit;
  } catch {
    return new Set();
  }
}

class StubCalendar implements CalendarProvider {
  readonly name = 'stub';
  async macroEvents(): Promise<CalendarEvent[]> { return []; }
  async earningsFor(): Promise<Set<string>> { return new Set(); }
}

class FreeCalendar implements CalendarProvider {
  readonly name: string;
  constructor(name: string) { this.name = name; }
  async macroEvents(): Promise<CalendarEvent[]> {
    return fmpMacroEvents(); // Finnhub free tier has no econ calendar → honestly omitted
  }
  async earningsFor(tickers: string[]): Promise<Set<string>> {
    const wanted = new Set(tickers.map((t) => t.toUpperCase()));
    if (config.fmpKey) return fmpEarningsFor(wanted);
    if (config.finnhubKey) return finnhubEarningsFor(wanted);
    return new Set();
  }
}

/** Human-readable description of the active calendar wiring (for boot logs). */
export function calendarProviderName(): string {
  const parts: string[] = [];
  if (config.fmpKey) parts.push('fmp-macro', 'fmp-earnings');
  else if (config.finnhubKey) parts.push('finnhub-earnings');
  return parts.length ? parts.join(' + ') : 'stub';
}

/** Build the calendar provider from configured keys. Never throws. */
export function makeCalendarProvider(): CalendarProvider {
  if (!config.fmpKey && !config.finnhubKey) return new StubCalendar();
  return new FreeCalendar(calendarProviderName());
}

export type { CalendarEvent, CalendarProvider } from './provider.js';
export { hasHighImpactToday } from './provider.js';
