// DARE Desk continuous runner — "say go, it runs."
//   npm run go        → online; scans every SCAN_INTERVAL_SEC during market hours
//   npm run stop      → writes data/STOP; the runner shuts down cleanly
//   Ctrl+C            → graceful shutdown
//   RUN_ONCE=true     → single pass then exit (for cron / testing)
//   RUN_OFFHOURS=true → scan even outside regular trading hours
//
// Each pass: refresh today's live market context (regime + verified news) →
// scan the universe → score/govern/firewall every candidate → post confident
// signals to Discord → persist data/state.json for the dashboard.

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DareDeskEngine } from './pipeline.js';
import { Scanner } from './scan/scanner.js';
import { makeProvider } from './data/index.js';
import { CachedMarketData } from './data/cache.js';
import { ExitMonitor } from './engine/exitMonitor.js';
import { postTradeMgmt, postNews, postArmed } from './discord/router.js';
import { BreakingNewsWatcher } from './news/breaking.js';
import { detectArmed, renderArmed, armedKey } from './scan/armed.js';
import type { ExitEvent, ArmedSignal } from './lib/types.js';
import type { TickerIntel, NewsRow } from './lib/state.js';
import { buildMarketContext } from './context/marketContext.js';
import { newsProviderName } from './news/index.js';
import { dispatchSignal } from './discord/dispatch.js';
import { writeState, rowFrom, dashboardMeta, type SignalRow } from './lib/state.js';
import { etTimeString } from './lib/clock.js';
import { fullUniverse } from './scan/universe.js';
import { config, hasLLM } from './lib/config.js';
import { inMarketHours, etMinutes } from './lib/clock.js';
import { postEodRecap } from './discord/recap.js';
import { makeCalendarProvider } from './calendar/index.js';

const STOP_FILE = join(process.cwd(), 'data', 'STOP');

let stopping = false;
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

process.on('SIGINT', () => { stopping = true; log('Ctrl+C — shutting down after this pass…'); });
process.on('SIGTERM', () => { stopping = true; });

// Cache bars only long enough to coalesce ONE tick's overlapping reads (scanner,
// trend, levels, breadth, exit monitor, intel all read the same bars) — short
// enough that the next scan gets fresh data. This is what lets the cadence run
// fast: duplicate reads within a pass hit the network once, the next pass refreshes.
const provider = new CachedMarketData(makeProvider(), Math.min(config.scanIntervalSec, 12) * 1000);
// The engine gets a live quote fn (chase guard + fill re-basing) and persists its
// day state / journal to data/. The exit monitor persists positions there too.
// No quote fn on mock data: the mock's per-timeframe walks are independent, so
// "drift" between them is synthetic — the chase guard is a live-data discipline.
const engine = new DareDeskEngine({ quote: provider.realtime ? (t) => provider.getQuote(t) : undefined });
const scanner = new Scanner(provider);
const exitMonitor = new ExitMonitor();
// Positions survive restarts — rebuild the aggregate-exposure limits from them
// so a restart never resurrects exposure while forgetting its guardrails.
engine.syncOpenPositions(exitMonitor.positions());
const newsWatcher = new BreakingNewsWatcher();

let recapPostedDate: string | null = null;
// Rolling feeds for the dashboard (kept small — state.json rewrites every tick).
const recentExitEvents: ExitEvent[] = [];
const recentNews: NewsRow[] = [];
const recentArmed: ArmedSignal[] = [];
const armedSeen = new Map<string, number>(); // dedup key -> last-armed epoch ms

/** Per-ticker intelligence for the Charts tab — bars, trend, levels, RVOL, flow.
 *  Reads are cache-backed, so this mostly reuses what the scan already fetched. */
async function buildIntel(): Promise<Record<string, TickerIntel>> {
  const out: Record<string, TickerIntel> = {};
  for (const symbol of fullUniverse()) {
    try {
      const q = await provider.getQuote(symbol);
      const base = await scanner.intelFor(symbol, q.price);
      const [fives, hours, days] = await Promise.all([
        provider.getBars(symbol, '5Min', 78).catch(() => []),
        provider.getBars(symbol, '1Hour', 60).catch(() => []),
        provider.getBars(symbol, '1Day', 60).catch(() => []),
      ]);
      out[symbol] = {
        ticker: symbol,
        price: q.price,
        trend: base.trend ?? null,
        levels: base.levels ?? null,
        rvol: base.rvol ?? null,
        chain: base.chain ? {
          netFlowBias: base.chain.netFlowBias,
          putCallVolRatio: base.chain.putCallVolRatio,
          callWall: base.chain.callWall,
          putWall: base.chain.putWall,
          gammaMagnets: base.chain.gammaMagnets,
          unusualStrikes: base.chain.unusualStrikes.slice(0, 3)
            .map((u) => ({ strike: u.strike, type: u.type, volOiRatio: u.volOiRatio })),
          note: base.chain.note,
        } : null,
        bars: { '5m': fives, '1h': hours, '1D': days.slice(-40) },
      };
    } catch {
      // One bad symbol never kills the tick.
    }
  }
  return out;
}

async function tick(): Promise<void> {
  engine.rollDay(); // ET date changed? archive the day + apply weekly brakes
  const baseCtx = await buildMarketContext(provider, fullUniverse());

  // Manage what's already ON before hunting new entries — the exit monitor
  // re-quotes every open paper position against the plan and talks about it
  // in #trade-management.
  const exitEvents = await exitMonitor.check(provider, engine);
  for (const ev of exitEvents) {
    log(ev.message);
    recentExitEvents.push(ev);
    await postTradeMgmt(ev.message);
  }

  // Breaking news → #news channel + dashboard feed (primes silently on first run).
  const { all: freshNews, breaking } = await newsWatcher.check(fullUniverse());
  for (const n of freshNews) {
    recentNews.push({
      headline: n.headline, source: n.source, url: n.url, at: n.at,
      symbols: n.symbols ?? [], breaking: breaking.includes(n),
    });
  }
  for (const n of breaking.slice(0, 3)) { // cap per tick — alerts, not a firehose
    log(`📰 breaking: ${n.headline} (${n.source})`);
    await postNews(BreakingNewsWatcher.render(n));
  }

  const candidates = await scanner.scanOnce(0.5, baseCtx.vix); // VIX-adaptive contracts
  const earners = await makeCalendarProvider().earningsFor(fullUniverse()); // live earnings (empty w/o key)

  const rows: SignalRow[] = [];
  let fired = 0;
  let watching = 0;
  for (const idea of candidates) {
    const ctx = { ...baseCtx, earningsSoon: earners.has(idea.ticker.toUpperCase()) };
    const res = await engine.evaluateIdea(idea, ctx);
    rows.push(rowFrom(res));
    const routed = await dispatchSignal(res);
    if (routed === 'signal') fired++;
    else if (routed === 'watch') watching++;
    // A real paper fill → hand it to the exit monitor to manage + announce.
    const opened = exitMonitor.open(res, baseCtx.spyTrend);
    if (opened?.events[0]) {
      log(opened.events[0].message);
      recentExitEvents.push(opened.events[0]);
      await postTradeMgmt(opened.events[0].message);
    }
  }

  // Intel for the dashboard AND for ARMED pre-trigger detection (computed once).
  const intel = await buildIntel();

  // ARMED — strongest plays coiling AT a trigger. Fire the heads-up BEFORE the
  // break so we're positioned, not chasing. Strict by construction (detectArmed),
  // deduped per name+direction+level, and never for a name already on.
  const onKeys = new Set(exitMonitor.positions().map((p) => `${p.ticker}:${p.direction}`));
  for (const sym of Object.keys(intel)) {
    const info = intel[sym]!;
    const a = detectArmed({ ticker: sym, price: info.price, trend: info.trend, levels: info.levels, rvol: info.rvol, chain: info.chain });
    if (!a || onKeys.has(`${a.ticker}:${a.direction}`)) continue;
    const key = armedKey(a);
    const last = armedSeen.get(key) ?? 0;
    if (Date.now() - last < config.risk.armCooldownMin * 60_000) continue;
    armedSeen.set(key, Date.now());
    recentArmed.push(a);
    log(renderArmed(a));
    await postArmed(renderArmed(a));
  }

  const expectancy = engine.journal.expectancy();
  const day = engine.dayState();
  // Trim the rolling feeds in place (state.json rewrites every tick).
  if (recentExitEvents.length > 100) recentExitEvents.splice(0, recentExitEvents.length - 100);
  if (recentNews.length > 60) recentNews.splice(0, recentNews.length - 60);
  if (recentArmed.length > 40) recentArmed.splice(0, recentArmed.length - 40);

  writeState({
    brand: config.botName,
    updatedAt: new Date().toISOString(),
    provider: `${provider.name}${provider.realtime ? ' (real-time)' : ' (mock)'}`,
    scanned: fullUniverse().length,
    signals: rows,
    journal: [...engine.journal.all()].slice(-200),
    summary: engine.journal.summary(),
    headlines: baseCtx.headlines,
    meta: dashboardMeta(),
    expectancy,
    proveIt: { proven: expectancy.proven, paperTrades: expectancy.trades, needed: config.risk.minPaperTrades },
    dayType: baseCtx.dayType,
    day: {
      date: day.date,
      realizedPnlUsd: day.realizedPnlUsd,
      peakPnlUsd: day.peakPnlUsd,
      tradesToday: day.tradesToday,
      openPositionsCount: day.openPositionsCount,
      openRiskUsd: day.openRiskUsd,
      sizeMultiplier: day.sizeMultiplier,
      standDownReason: day.standDownReason,
      cooldownUntil: day.cooldownUntil,
    },
    positions: exitMonitor.views(),
    exitEvents: [...recentExitEvents].reverse(), // newest first for the feed
    closedTrades: [...engine.journal.closedTrades()],
    intel,
    news: [...recentNews].reverse(),
    armed: [...recentArmed].reverse(),
  });

  // EOD auto-recap — once per day at/after the 0DTE flat-by time (~15:55 ET).
  const today = new Date().toISOString().slice(0, 10);
  if (etMinutes() >= config.risk.zeroDteFlatByMinEt && recapPostedDate !== today) {
    recapPostedDate = today;
    await postEodRecap({ date: today, botName: config.botName, summary: engine.journal.summary(), expectancy });
    log('EOD recap posted.');
  }

  const onCount = exitMonitor.positions().length;
  const armedCount = recentArmed.length;
  log(`scan: ${candidates.length} candidates · ${fired} fired · ${watching} watching · ${armedCount} armed · ${onCount} position${onCount === 1 ? '' : 's'} on · regime SPY ${baseCtx.spyTrend}/QQQ ${baseCtx.qqqTrend} · VIX≈${baseCtx.vix} · F&G ${baseCtx.fearGreed}`);
}

/** Interruptible sleep — wakes early on shutdown. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (stopping || Date.now() - start >= ms) { clearInterval(id); resolve(); }
    }, 500);
  });
}

async function main(): Promise<void> {
  const once = (process.env.RUN_ONCE || '').toLowerCase() === 'true';
  log(`${config.botName} ONLINE 🟢  feed=${provider.name} · news=${newsProviderName()} · LLM=${hasLLM() ? config.scorerModel : 'heuristic'} · every ${config.scanIntervalSec}s`);
  log(`Universe (${fullUniverse().length}): ${fullUniverse().join(', ')} · stop with Ctrl+C or "npm run stop"`);

  if (once) { await tick(); log('RUN_ONCE — done.'); return; }

  while (!stopping) {
    if (existsSync(STOP_FILE)) { try { unlinkSync(STOP_FILE); } catch {} log('STOP signal received.'); break; }
    if (config.runOffHours || inMarketHours()) await tick();
    else log('market closed — idling (set RUN_OFFHOURS=true to scan anyway)');
    if (stopping) break;
    await sleep(config.scanIntervalSec * 1000);
  }
  log(`${config.botName} OFFLINE 🔴`);
}

main().catch((e) => { console.error(e); process.exit(1); });
