// History source for the replay backtest. Two providers, same output shape:
//   synthHistory  — deterministic multi-day OHLCV, runs fully offline (tests + a
//                   no-keys backtest). Mixes trend days and chop days so the
//                   day-type/discipline gates get exercised.
//   alpacaHistory — real bars from Alpaca's free tier (used when keys are set).
// Both return a BarStore: store[SYMBOL][timeframe] = ascending bars.

import type { Bar, BarTimeframe } from '../data/provider.js';
import type { BarStore } from './replayProvider.js';
import { config } from '../lib/config.js';

const RTH_START_MIN = 570; // 9:30 ET
const RTH_BARS = 390;      // one 1-min bar per RTH minute

/** Epoch ms for a Y-M-D at a given minute-of-day in ET (EDT −04:00 assumed —
 *  the synthetic range is summer, so no DST ambiguity). */
function etMs(dateStr: string, minuteOfDay: number): number {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return Date.parse(`${dateStr}T${hh}:${mm}:00-04:00`);
}

/** Seeded LCG — reproducible walks without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const BASE: Record<string, number> = {
  SPY: 600, QQQ: 520, IWM: 220, DIA: 430, SMH: 260, MU: 130, NVDA: 145, AMD: 170,
  AVGO: 260, TSLA: 250, META: 620, NFLX: 900, AAPL: 230, MSFT: 480, AMZN: 200, GOOGL: 190,
};

/** N consecutive weekdays ending at `endDate` (inclusive), oldest first. */
function tradingDays(endDate: string, n: number): string[] {
  const days: string[] = [];
  const d = new Date(`${endDate}T12:00:00-04:00`);
  while (days.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days.reverse();
}

/** Aggregate 1-min bars into a coarser timeframe by fixed minute buckets (intraday)
 *  or one bar per day (1Day). Bucket time = the bucket's first bar open. */
function aggregate(oneMin: Bar[], tf: BarTimeframe): Bar[] {
  if (tf === '1Min') return oneMin;
  const perDay = tf === '1Day';
  const size = tf === '5Min' ? 5 : tf === '15Min' ? 15 : tf === '1Hour' ? 60 : tf === '4Hour' ? 240 : RTH_BARS;
  const out: Bar[] = [];
  const keyFor = (b: Bar): string => {
    const day = new Date(b.t).toISOString().slice(0, 10);
    if (perDay) return day;
    const minsIntoDay = Math.floor((b.t - etMs(day, 0)) / 60_000);
    return `${day}:${Math.floor((minsIntoDay - RTH_START_MIN) / size)}`;
  };
  let cur: Bar | null = null;
  let curKey = '';
  for (const b of oneMin) {
    const k = keyFor(b);
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curKey = k;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface SynthOpts {
  symbols?: string[];
  days?: number;
  endDate?: string; // YYYY-MM-DD (last trading day), default anchors near "now"
  seed?: number;
}

/** Deterministic multi-day history. Each day gets a regime (trend up/down/chop)
 *  so the replay sees varied tape; the walk respects prior close so days connect. */
export function synthHistory(opts: SynthOpts = {}): BarStore {
  const symbols = opts.symbols ?? Object.keys(BASE);
  const days = opts.days ?? 20;
  const endDate = opts.endDate ?? '2026-06-26';
  const seed = opts.seed ?? 42;
  const dates = tradingDays(endDate, days);
  const store: BarStore = {};

  for (const sym of symbols) {
    const rand = lcg(seed ^ hash(sym));
    let price = BASE[sym] ?? 100;
    const vol = price * 0.0012;
    const oneMin: Bar[] = [];
    // Daily trend momentum — random-walks day to day so the series has real
    // multi-day up/down RUNS (not day-independent noise). This is what makes the
    // 20-day regime read up/down and lets clean continuation setups fire.
    let dayDrift = 0;

    for (let di = 0; di < dates.length; di++) {
      const date = dates[di]!;
      // Nudge the daily trend, mean-reverting so it doesn't run away; occasional
      // regime flips. Trend days get a firm intrabar drift, chop days near zero.
      dayDrift = dayDrift * 0.7 + (rand() - 0.5) * vol * 0.9;
      const trendDay = Math.abs(dayDrift) > vol * 0.25;
      const drift = trendDay ? dayDrift : (rand() - 0.5) * vol * 0.08;
      for (let m = 0; m < RTH_BARS; m++) {
        const t = etMs(date, RTH_START_MIN + m);
        const o = price;
        const move = (rand() - 0.5) * 2 * vol + drift;
        const c = Math.max(1, o + move);
        const h = Math.max(o, c) + rand() * vol * 0.6;
        const l = Math.min(o, c) - rand() * vol * 0.6;
        const vmult = m < 30 || m > 360 ? 1.8 : 1; // open/close power hours run hot
        const v = Math.round((400_000 + rand() * 1_600_000) * vmult);
        oneMin.push({ t, o, h, l, c, v });
        price = c;
      }
    }

    store[sym] = {
      '1Min': oneMin,
      '5Min': aggregate(oneMin, '5Min'),
      '15Min': aggregate(oneMin, '15Min'),
      '1Hour': aggregate(oneMin, '1Hour'),
      '4Hour': aggregate(oneMin, '4Hour'),
      '1Day': aggregate(oneMin, '1Day'),
    };
  }
  return store;
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// --- Real history from Alpaca (free tier) ----------------------------------------

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number }

const TF_PARAM: Record<BarTimeframe, string> = {
  '1Min': '1Min', '5Min': '5Min', '15Min': '15Min', '1Hour': '1Hour', '4Hour': '4Hour', '1Day': '1Day',
};

/** Fetch real bars for [start,end) from Alpaca, paginating. Never throws — returns
 *  what it got. Requires ALPACA_API_KEY + ALPACA_SECRET. */
export async function alpacaHistory(symbols: string[], startISO: string, endISO: string): Promise<BarStore> {
  const store: BarStore = {};
  const tfs: BarTimeframe[] = ['1Min', '5Min', '15Min', '1Hour', '4Hour', '1Day'];
  for (const sym of symbols) {
    store[sym] = {};
    for (const tf of tfs) {
      store[sym]![tf] = await fetchAlpacaBars(sym, tf, startISO, endISO).catch(() => []);
    }
  }
  return store;
}

async function fetchAlpacaBars(symbol: string, tf: BarTimeframe, startISO: string, endISO: string): Promise<Bar[]> {
  const bars: Bar[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://data.alpaca.markets/v2/stocks/bars');
    url.searchParams.set('symbols', symbol);
    url.searchParams.set('timeframe', TF_PARAM[tf]);
    url.searchParams.set('start', startISO);
    url.searchParams.set('end', endISO);
    url.searchParams.set('limit', '10000');
    url.searchParams.set('feed', config.alpaca.feed);
    url.searchParams.set('adjustment', 'raw');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': config.alpaca.key, 'APCA-API-SECRET-KEY': config.alpaca.secret },
    });
    if (!res.ok) break;
    const data = (await res.json()) as { bars?: Record<string, AlpacaBar[]>; next_page_token?: string };
    for (const b of data.bars?.[symbol] ?? []) bars.push({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    pageToken = data.next_page_token ?? undefined;
  } while (pageToken);
  return bars;
}
