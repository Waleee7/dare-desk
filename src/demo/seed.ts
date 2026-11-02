// Deterministic DEMO state for the dashboard — no keys, no network, no files.
//
// buildDemoState({ seed, tick, now }) is a PURE function: the same inputs always
// return the same DashboardState, so screenshots, tests and docs are reproducible.
// Everything it returns is SYNTHETIC and flagged `demo: true`; the dashboard
// labels it DEMO DATA. Nothing here is a market prediction or a real fill.
//
// `tick` advances a small scripted scenario (the dashboard bumps it every poll):
//   phase = tick % 6
//   phase >= 2  a second ARMED pre-trigger alert appears (TSLA)
//   phase >= 4  a new A-grade signal fires and a third paper position opens (GOOGL)
// Position marks drift a little every tick. Chart bars do not depend on `tick`.

import type { DashboardState, SignalRow, TickerIntel } from '../lib/state.js';
import type { Bar } from '../data/provider.js';
import type {
  ClosedTrade, ExitEvent, ExpectancyStats, OpenPosition, ArmedSignal,
  TimeframeTrend, Tier, Grade,
} from '../lib/types.js';

export const DEMO_SEED = 7;
export const DEMO_PHASES = 6;

export interface DemoOptions {
  seed?: number;
  tick?: number;
  /** Epoch ms or Date — anchors every timestamp. Defaults to Date.now(). */
  now?: number | Date;
}

// ---- tiny deterministic PRNG (mulberry32) ----------------------------------
function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ---- synthetic universe ------------------------------------------------------
interface Sym { t: string; px: number; bias: number; tier: Tier }
const UNIVERSE: Sym[] = [
  { t: 'SPY', px: 612.4, bias: -0.2, tier: 'core' },
  { t: 'QQQ', px: 541.1, bias: 0.3, tier: 'core' },
  { t: 'IWM', px: 231.8, bias: 0.0, tier: 'core' },
  { t: 'NVDA', px: 142.3, bias: 0.8, tier: 'focus' },
  { t: 'AMD', px: 168.2, bias: 0.5, tier: 'focus' },
  { t: 'AVGO', px: 231.5, bias: 0.4, tier: 'focus' },
  { t: 'TSLA', px: 342.7, bias: -0.6, tier: 'focus' },
  { t: 'META', px: 705.2, bias: 0.6, tier: 'focus' },
  { t: 'AAPL', px: 228.4, bias: 0.1, tier: 'core' },
  { t: 'MSFT', px: 468.9, bias: 0.2, tier: 'core' },
  { t: 'AMZN', px: 214.6, bias: 0.3, tier: 'core' },
  { t: 'GOOGL', px: 191.3, bias: 0.4, tier: 'extended' },
];
const PX = Object.fromEntries(UNIVERSE.map((s) => [s.t, s])) as Record<string, Sym>;

function makeBars(sym: Sym, n: number, stepMs: number, volBase: number, endMs: number, seed: number, vol: number): Bar[] {
  const rnd = mulberry32(hash(`${sym.t}:${stepMs}`, seed));
  const raw: Bar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = o * (1 + (rnd() - 0.5 + sym.bias * 0.04) * vol);
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.35);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.35);
    raw.push({ t: endMs - (n - 1 - i) * stepMs, o, h, l, c, v: Math.round(volBase * (0.5 + rnd() * 1.1)) });
    px = c;
  }
  const k = sym.px / raw[n - 1]!.c; // rescale so the last close IS the quoted price
  return raw.map((b) => ({ t: b.t, o: r2(b.o * k), h: r2(b.h * k), l: r2(b.l * k), c: r2(b.c * k), v: b.v }));
}

const ET_DATE = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
/** ET calendar date `days` ahead, rolled forward off weekends (a listed expiry is never a Saturday). */
function expiryAfter(ms: number, days: number): string {
  let d = ms + days * 86_400_000;
  for (let i = 0; i < 3; i++) {
    const dow = new Date(`${ET_DATE(d)}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d += 86_400_000;
  }
  return ET_DATE(d);
}
const iso = (ms: number): string => new Date(ms).toISOString();

function expectancyOf(closed: ClosedTrade[], needed: number): ExpectancyStats {
  const wins = closed.filter((t) => t.rMultiple > 0);
  const losses = closed.filter((t) => t.rMultiple <= 0);
  const sum = (a: ClosedTrade[]) => a.reduce((s, t) => s + t.rMultiple, 0);
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;
  const expectancyR = closed.length ? sum(closed) / closed.length : 0;
  const grossLoss = Math.abs(sum(losses));
  const byRegime = { up: { trades: 0, expectancyR: 0 }, down: { trades: 0, expectancyR: 0 }, flat: { trades: 0, expectancyR: 0 } };
  for (const k of ['up', 'down', 'flat'] as const) {
    const sub = closed.filter((t) => t.regime === k);
    byRegime[k] = { trades: sub.length, expectancyR: sub.length ? r2(sum(sub) / sub.length) : 0 };
  }
  const adequate = closed.length >= needed;
  return {
    trades: closed.length,
    winRate: closed.length ? r2(wins.length / closed.length) : 0,
    avgWin: r2(avgWin),
    avgLoss: r2(avgLoss),
    expectancyR: r2(expectancyR),
    profitFactor: grossLoss > 0 ? r2(sum(wins) / grossLoss) : 0,
    avgHoldMinutes: closed.length ? r2(closed.reduce((s, t) => s + t.holdMinutes, 0) / closed.length) : 0,
    byRegime,
    sampleSizeAdequate: adequate,
    proven: adequate && expectancyR > 0 && Object.values(byRegime).every((b) => b.trades === 0 || b.expectancyR >= 0),
  };
}

// Stop at -35% premium => 1R. exit = fill * (1 + 0.35R). Hand-authored so the
// demo history is a plausible, modest edge — and clearly short of the 100-trade bar.
const HISTORY: Array<[string, string, Tier, string, string, number, number, number, 'up' | 'down' | 'flat', number]> = [
  // ticker, setup, tier, in, out, fill, contracts, R, regime, holdMin
  ['SPY', 'VWAP reclaim', 'core', '09:48:10', '10:31:40', 2.9, 1, 1.2, 'up', 43],
  ['NVDA', 'Opening-range breakout', 'focus', '10:05:22', '10:19:05', 3.4, 1, -1.0, 'up', 14],
  ['QQQ', 'Momentum continuation', 'core', '14:12:48', '14:58:12', 2.6, 2, 0.8, 'up', 46],
  ['TSLA', 'Range breakdown', 'focus', '10:22:31', '10:40:09', 5.1, 1, -1.0, 'down', 18],
  ['AMD', 'Liquidity sweep reclaim', 'focus', '09:41:03', '10:44:59', 3.1, 1, 1.5, 'up', 63],
  ['META', 'Gap-up continuation', 'focus', '09:55:40', '10:20:15', 7.4, 1, -0.7, 'flat', 25],
  ['AAPL', 'Trend pullback', 'core', '13:58:09', '14:51:44', 2.2, 2, 1.0, 'flat', 54],
  ['IWM', 'Range breakdown', 'core', '10:09:16', '10:33:02', 1.9, 2, -1.0, 'flat', 24],
  ['AVGO', 'VWAP reclaim', 'focus', '09:52:27', '11:02:36', 4.6, 1, 1.8, 'up', 70],
  ['MSFT', 'Gap-down continuation', 'core', '10:14:50', '10:39:21', 3.8, 1, -1.0, 'down', 25],
  ['SPY', 'Opening-range breakout', 'core', '09:46:33', '10:21:18', 3.3, 1, 0.9, 'up', 35],
  ['NVDA', 'Momentum continuation', 'focus', '14:20:05', '14:47:50', 3.0, 1, -0.4, 'down', 28],
];

export function buildDemoState(opts: DemoOptions = {}): DashboardState {
  const seed = opts.seed ?? DEMO_SEED;
  const tick = Math.max(0, Math.floor(opts.tick ?? 0));
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const phase = tick % DEMO_PHASES;
  const wobble = mulberry32(hash(`tick:${tick}`, seed));
  const ago = (min: number) => iso(now - min * 60_000);
  const bar5 = Math.floor(now / 300_000) * 300_000;
  const barH = Math.floor(now / 3_600_000) * 3_600_000;
  const barD = Math.floor(now / 86_400_000) * 86_400_000;

  // ---- charts / intel ----
  const intel: Record<string, TickerIntel> = {};
  for (const s of UNIVERSE) {
    const bars = {
      '5m': makeBars(s, 78, 300_000, 900_000, bar5, seed, 0.0042),
      '1h': makeBars(s, 60, 3_600_000, 4_000_000, barH, seed, 0.0085),
      '1D': makeBars(s, 40, 86_400_000, 30_000_000, barD, seed, 0.016),
    };
    const daily = bars['1D'];
    const pdh = Math.max(...daily.slice(-2, -1).map((b) => b.h));
    const pdl = Math.min(...daily.slice(-2, -1).map((b) => b.l));
    const step = s.px > 400 ? 5 : s.px > 150 ? 2.5 : 1;
    const callWall = Math.ceil((s.px * 1.012) / step) * step;
    const putWall = Math.floor((s.px * 0.988) / step) * step;
    const dir = (x: number) => (x > 0.15 ? 'up' : x < -0.15 ? 'down' : 'flat') as 'up' | 'down' | 'flat';
    const tfs: TimeframeTrend[] = (['15m', '1h', '4h', '1D'] as const).map((label, i) => {
      const b = s.bias + (i === 0 ? (hash(s.t, seed) % 7 - 3) * 0.05 : 0);
      return {
        label, dir: dir(b),
        emaFast: r2(s.px * (1 + b * 0.002)), emaSlow: r2(s.px * (1 - b * 0.004)),
        rsi: Math.round(50 + b * 14 + ((hash(s.t + label, seed) % 9) - 4)),
        pctFromEmaSlow: r2(b * 0.9),
      };
    });
    const allUp = tfs.every((t) => t.dir === 'up');
    const allDown = tfs.every((t) => t.dir === 'down');
    const rvol = r2(0.7 + ((hash(`rv${s.t}`, seed) % 140) / 100));
    intel[s.t] = {
      ticker: s.t,
      price: s.px,
      trend: {
        ticker: s.t, asOf: iso(now), timeframes: tfs,
        alignment: allUp ? 'aligned-up' : allDown ? 'aligned-down' : 'mixed',
        alignScore: Math.round(tfs.filter((t) => t.dir === (s.bias >= 0 ? 'up' : 'down')).length * 25),
      },
      levels: {
        ticker: s.t, asOf: iso(now), price: s.px,
        support: [r2(s.px * 0.991), r2(s.px * 0.978)], resistance: [r2(s.px * 1.009), r2(s.px * 1.021)],
        volumeNodes: [r2(s.px * 0.996), r2(s.px * 1.004)],
        callWall, putWall, gammaMagnets: [r2(Math.round(s.px / step) * step)],
        prevDayHigh: r2(pdh), prevDayLow: r2(pdl), prevClose: daily[daily.length - 2]!.c,
      },
      rvol: { ticker: s.t, rvol, lastBarSurge: rvol > 1.5, note: rvol > 1.5 ? 'Participation running hot vs 20-day average.' : 'Participation near normal.' },
      chain: {
        netFlowBias: s.bias > 0.25 ? 'bullish' : s.bias < -0.25 ? 'bearish' : 'mixed',
        putCallVolRatio: r2(0.85 - s.bias * 0.35),
        callWall, putWall, gammaMagnets: [r2(Math.round(s.px / step) * step)],
        unusualStrikes: [{ strike: callWall, type: 'call', volOiRatio: r2(1.8 + (hash(`u${s.t}`, seed) % 20) / 10) }],
        note: 'Synthetic demo chain — not a market read.',
      },
      bars,
    };
  }

  // ---- closed paper trades (history) ----
  const closed: ClosedTrade[] = HISTORY.map(([ticker, setup, tier, inT, outT, fill, n, R, regime, hold]) => {
    const exit = r2(fill * (1 + 0.35 * R));
    return {
      ticker, setup, tier, entryTimeEt: inT, exitTimeEt: outT,
      fillPremium: fill, exitPremium: exit, contracts: n,
      costPaidUsd: r2(fill * 100 * n), pnlUsd: r2((exit - fill) * 100 * n), rMultiple: R,
      holdMinutes: hold, result: R > 0 ? 'win' : 'loss', regime,
    };
  });
  const closedToday = closed.slice(-2);
  const bankedTp1 = 69; // NVDA runner: half already scaled at TP1

  // ---- open positions ----
  const mark = (base: number, drift: number) => r2(Math.max(0.05, base + (wobble() - 0.5) * drift));
  const nvdaEst = mark(3.05, 0.34);
  const spyEst = mark(3.9, 0.3);
  const mkPos = (p: Omit<OpenPosition, 'delta' | 'warnedTp1' | 'warnedStop' | 'scaledOutPremium' | 'openedAtMs' | 'minutesToCloseAtEntry' | 'entryUnderlying' | 'costPaidUsd' | 'events' | 'lastUnderlying' | 'lastEstPremium'> & { est: number; events: ExitEvent[]; underlying: number; scaled?: number }) => {
    const { est, events, underlying, scaled, ...rest } = p;
    const pos: OpenPosition = {
      ...rest, delta: 0.5, warnedTp1: false, warnedStop: false,
      scaledOutPremium: scaled ?? null, openedAtMs: now - 90 * 60_000, minutesToCloseAtEntry: 330,
      entryUnderlying: underlying, costPaidUsd: r2(rest.fillPremium * 100 * rest.initialContracts),
      lastEstPremium: est, lastUnderlying: underlying, events,
    };
    const plUsd = r2((est - pos.fillPremium) * 100 * pos.contracts);
    return { ...pos, plUsd, plPct: r2(((est / pos.fillPremium) - 1) * 100) };
  };
  const ev = (minAgo: number, etTime: string, kind: ExitEvent['kind'], ticker: string, id: string, message: string, est: number | null, pct: number | null): ExitEvent =>
    ({ at: ago(minAgo), etTime, kind, ticker, positionId: id, message, estPremium: est, premiumPct: pct });

  const nvdaEvents = [
    ev(78, '10:12:04', 'opened', 'NVDA', 'DEMO-1', 'NVDA calls in at $2.30 x2 — exit plan armed: TP1 $2.99, TP2 $3.68, stop $1.50.', 2.3, 0),
    ev(41, '10:49:31', 'tp1_scaled', 'NVDA', 'DEMO-1', 'NVDA hit TP1 — banked half at $2.99, runner stays on, stop moved to breakeven.', 2.99, 30),
  ];
  const spyEvents = [
    ev(33, '10:57:18', 'opened', 'SPY', 'DEMO-2', 'SPY puts in at $4.20 x1 — exit plan armed: TP1 $5.46, TP2 $6.72, stop $2.73.', 4.2, 0),
    ev(9, '11:21:02', 'approaching_stop', 'SPY', 'DEMO-2', 'SPY puts working against us — premium is approaching the stop; it gets cut at $2.73, no widening.', 3.78, -10),
  ];
  const positions = [
    mkPos({
      id: 'DEMO-1', ticker: 'NVDA', direction: 'long', setup: 'Opening-range breakout', tier: 'focus', grade: 'A+',
      contract: { ticker: 'NVDA', optionType: 'call', strike: 142, expiry: ET_DATE(now), dte: 0 },
      horizon: 'scalp', contracts: 1, initialContracts: 2, entryTimeEt: '10:12:04', fillPremium: 2.3,
      tp1Premium: 2.99, tp2Premium: 3.68, stopPremium: 1.5, timeStopMin: 0, zeroDte: true, status: 'runner',
      regime: 'up', est: nvdaEst, underlying: 142.3, scaled: 2.99, events: nvdaEvents,
    }),
    mkPos({
      id: 'DEMO-2', ticker: 'SPY', direction: 'short', setup: 'Range breakdown', tier: 'core', grade: 'A',
      contract: { ticker: 'SPY', optionType: 'put', strike: 612, expiry: expiryAfter(now, 2), dte: 2 },
      horizon: 'intraday', contracts: 1, initialContracts: 1, entryTimeEt: '10:57:18', fillPremium: 4.2,
      tp1Premium: 5.46, tp2Premium: 6.72, stopPremium: 2.73, timeStopMin: 90, zeroDte: false, status: 'open',
      regime: 'down', est: spyEst, underlying: 612.4, events: spyEvents,
    }),
  ];
  const newFire = phase >= 4;
  if (newFire) {
    positions.push(mkPos({
      id: 'DEMO-3', ticker: 'GOOGL', direction: 'long', setup: 'VWAP reclaim', tier: 'extended', grade: 'A',
      contract: { ticker: 'GOOGL', optionType: 'call', strike: 192.5, expiry: expiryAfter(now, 4), dte: 4 },
      horizon: 'intraday', contracts: 2, initialContracts: 2, entryTimeEt: '11:24:40', fillPremium: 1.85,
      tp1Premium: 2.4, tp2Premium: 2.96, stopPremium: 1.2, timeStopMin: 75, zeroDte: false, status: 'open',
      regime: 'up', est: mark(1.88, 0.1), underlying: 191.3,
      events: [ev(1, '11:24:40', 'opened', 'GOOGL', 'DEMO-3', 'GOOGL calls in at $1.85 x2 — exit plan armed: TP1 $2.40, TP2 $2.96, stop $1.20.', 1.85, 0)],
    }));
  }
  const exitEvents = positions.flatMap((p) => p.events).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const openRiskUsd = Math.round(positions.reduce((s, p) => s + (p.status === 'runner' ? 0 : (p.fillPremium - p.stopPremium) * 100 * p.contracts), 0));
  const realized = r2(closedToday.reduce((s, t) => s + t.pnlUsd, 0) + bankedTp1);

  // ---- signals: what fired, what was only watched, what the firewall vetoed ----
  const sig = (
    minAgo: number, ticker: string, setup: string, direction: 'long' | 'short', grade: Grade, confidence: number,
    entry: number, stop: number, targets: number[], contract: string, fired: boolean, blocks: string[], etTime: string,
    rr: number | null = 1.9,
  ): SignalRow => ({
    time: ago(minAgo), ticker, setup, timeframe: 'intraday', direction, contract, entry, stop, targets, grade,
    total: confidence, confidence, rewardRisk: rr, status: fired ? 'alert' : 'rejected', fired, blocks,
    tier: PX[ticker]!.tier, entryTimeEt: etTime, costPaidUsd: fired ? 185 : null, rMultiple: null, result: '',
  });
  const exp = expiryAfter(now, 2);
  const signals: SignalRow[] = [
    sig(78, 'NVDA', 'Opening-range breakout', 'long', 'A+', 91, 142.3, 140.6, [144.0, 145.7], `NVDA 142C ${ET_DATE(now)}`, true, [], '10:12:04'),
    sig(33, 'SPY', 'Range breakdown', 'short', 'A', 82, 612.4, 614.9, [609.0, 606.2], `SPY 612P ${exp}`, true, [], '10:57:18'),
    sig(5, 'META', 'Gap-up continuation', 'long', 'B', 74, 705.2, 700.4, [711.0], `META 705C ${exp}`, false, ['grade_B — not tradeable (watch/no-trade)'], '11:28:00'),
    sig(5, 'QQQ', 'VWAP reclaim', 'long', 'B', 71, 541.1, 538.9, [544.0], `QQQ 541C ${exp}`, false, ['grade_B — not tradeable (watch/no-trade)'], '11:28:00'),
    sig(5, 'AMD', 'Liquidity sweep reclaim', 'long', 'A', 83, 168.2, 166.4, [170.4, 172.0], `AMD 168C ${exp}`, false, ['correlation_heat (2/2 semis)'], '11:28:00'),
    sig(5, 'TSLA', 'Range breakdown', 'short', 'A+', 90, 342.7, 346.2, [336.0], `TSLA 342P ${exp}`, false, ['lunch_lull_suppressed (11:30-13:30 ET)'], '11:28:00', 1.6),
    sig(5, 'AVGO', 'Trend pullback', 'long', 'A', 80, 231.5, 229.6, [235.0, 237.4], `AVGO 235C ${exp}`, false, ['spread_too_wide (11.4% > 8% at the 235 strike)'], '11:28:00'),
    sig(5, 'AAPL', 'Opening-range breakout', 'long', 'A', 78, 228.4, 227.0, [229.6], `AAPL 230C ${exp}`, false, ['reward_risk 1.12 < 1.5'], '11:28:00', 1.12),
    sig(5, 'MSFT', 'Momentum continuation', 'long', 'A', 79, 468.9, 466.0, [474.0, 477.0], `MSFT 470C ${exp}`, false, ['chased (0.71% past entry > 0.5%)'], '11:28:00'),
    sig(5, 'IWM', 'Range breakdown', 'short', 'A', 77, 231.8, 233.1, [229.4], `IWM 232P ${exp}`, false, ['open_risk_cap ($147 at-stop on + ~$188 > $300 total)'], '11:28:00'),
    sig(5, 'AMZN', 'VWAP reclaim', 'long', 'C', 66, 214.6, 213.2, [216.4], `AMZN 215C ${exp}`, false, ['grade_C — not tradeable (watch/no-trade)'], '11:28:00'),
  ];
  if (newFire) {
    signals.unshift(sig(1, 'GOOGL', 'VWAP reclaim', 'long', 'A', 84, 191.3, 190.2, [193.0, 194.6], `GOOGL 192.5C ${expiryAfter(now, 4)}`, true, [], '11:24:40'));
  } else {
    signals.push(sig(5, 'GOOGL', 'VWAP reclaim', 'long', 'C', 64, 191.3, 190.2, [193.0], `GOOGL 192.5C ${expiryAfter(now, 4)}`, false, ['grade_C — not tradeable (watch/no-trade)'], '11:28:00'));
  }

  const journal = [...signals].reverse().map((s) => ({
    at: s.time, ticker: s.ticker, setup: s.setup, grade: s.grade, total: s.total, confidence: s.confidence,
    outcome: (s.fired ? 'alerted' : s.grade === 'B' ? 'watch' : 'skipped') as 'alerted' | 'watch' | 'skipped',
    approved: s.fired, blocks: s.blocks,
    brokerMessage: s.fired ? 'paper fill (modeled)' : '(no order placed)', mistakeTags: [],
  }));
  const tally = new Map<string, number>();
  for (const j of journal) for (const b of j.blocks) tally.set(b.split(' ')[0]!, (tally.get(b.split(' ')[0]!) ?? 0) + 1);

  // ---- ARMED pre-trigger alerts ----
  const armed: ArmedSignal[] = [{
    ticker: 'META', direction: 'long', triggerLevel: 708, price: 706.9, distancePct: 0.16, rvol: 1.9, flowBias: 'bullish', alignment: 'aligned-up',
    why: 'META is coiled under 708 — 4 timeframes stacked up, volume 1.9x, call flow agreeing. Break of 708 triggers the call.', etTime: '11:27:10',
  }];
  if (phase >= 2) {
    armed.unshift({
      ticker: 'TSLA', direction: 'short', triggerLevel: 340.5, price: 341.2, distancePct: 0.21, rvol: 2.2, flowBias: 'bearish', alignment: 'aligned-down',
      why: 'TSLA is pressing 340.5 — stacked down on every timeframe, volume 2.2x, put flow agreeing. Break of 340.5 triggers the put.', etTime: '11:31:45',
    });
  }

  const expectancy = expectancyOf(closed, 100);
  const needed = 100;
  return {
    brand: 'DARE Desk',
    updatedAt: iso(now),
    provider: 'demo (synthetic)',
    scanned: UNIVERSE.length,
    demo: true,
    signals, journal,
    summary: {
      total: journal.length,
      alerted: journal.filter((j) => j.outcome === 'alerted').length,
      watched: journal.filter((j) => j.outcome === 'watch').length,
      skipped: journal.filter((j) => j.outcome === 'skipped').length,
      topBlocks: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`),
    },
    headlines: ['DEMO DATA — every price, headline and fill on this screen is synthetic.'],
    meta: {
      llm: 'heuristic (demo)', newsProvider: 'demo', scanIntervalSec: 30,
      marketHours: 'ET 9:30–16:00 · Mon–Fri', accountSizeUsd: 10_000, maxRiskPerTradePct: 1, maxDailyLossPct: 3, liveTrading: false,
    },
    expectancy,
    proveIt: { proven: expectancy.proven, paperTrades: closed.length, needed },
    dayType: 'trend-up',
    day: {
      date: ET_DATE(now), realizedPnlUsd: realized, peakPnlUsd: r2(Math.max(realized, 142.0)),
      tradesToday: closedToday.length + positions.length, openPositionsCount: positions.length, openRiskUsd,
      sizeMultiplier: 1, standDownReason: null, cooldownUntil: null,
    },
    positions, exitEvents, closedTrades: closed, intel,
    news: [
      { headline: 'Synthetic breaking item: chip names gap higher on a sample earnings read-through', source: 'DEMO WIRE', url: '', at: ago(14), symbols: ['NVDA', 'AMD', 'AVGO'], breaking: true },
      { headline: 'Index futures firm into the open; sample breadth improving', source: 'DEMO WIRE', url: '', at: ago(96), symbols: ['SPY', 'QQQ'], breaking: false },
      { headline: 'Sample analyst note raises a price target on a mega-cap internet name', source: 'DEMO WIRE', url: '', at: ago(131), symbols: ['META', 'GOOGL'], breaking: false },
      { headline: 'Sample EV-delivery chatter pressures the name below a key level', source: 'DEMO WIRE', url: '', at: ago(188), symbols: ['TSLA'], breaking: false },
      { headline: 'Rates steady in a sample macro calendar; no scheduled event inside the window', source: 'DEMO WIRE', url: '', at: ago(240), symbols: ['SPY', 'IWM'], breaking: false },
    ],
    armed,
    // state.ts types `closedTrades`/`exitEvents` etc. as above; nothing else is set.
  } satisfies DashboardState;
}
