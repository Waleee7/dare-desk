// PremiumFloor continuous runner — "say go, it runs."
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
import { PremiumFloorEngine } from './pipeline.js';
import { Scanner } from './scan/scanner.js';
import { makeProvider } from './data/index.js';
import { buildMarketContext } from './context/marketContext.js';
import { newsProviderName } from './news/index.js';
import { dispatchSignal } from './discord/dispatch.js';
import { writeState, rowFrom, dashboardMeta, type SignalRow } from './lib/state.js';
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

const provider = makeProvider();
const engine = new PremiumFloorEngine();
const scanner = new Scanner(provider);

let recapPostedDate: string | null = null;

async function tick(): Promise<void> {
  const baseCtx = await buildMarketContext(provider, fullUniverse());
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
  }

  const expectancy = engine.journal.expectancy();
  writeState({
    brand: config.botName,
    updatedAt: new Date().toISOString(),
    provider: `${provider.name}${provider.realtime ? ' (real-time)' : ' (mock)'}`,
    scanned: fullUniverse().length,
    signals: rows,
    journal: [...engine.journal.all()],
    summary: engine.journal.summary(),
    headlines: baseCtx.headlines,
    meta: dashboardMeta(),
    expectancy,
    proveIt: { proven: expectancy.proven, paperTrades: expectancy.trades, needed: config.risk.minPaperTrades },
  });

  // EOD auto-recap — once per day at/after the 0DTE flat-by time (~15:55 ET).
  const today = new Date().toISOString().slice(0, 10);
  if (etMinutes() >= config.risk.zeroDteFlatByMinEt && recapPostedDate !== today) {
    recapPostedDate = today;
    await postEodRecap({ date: today, botName: config.botName, summary: engine.journal.summary(), expectancy });
    log('EOD recap posted.');
  }

  log(`scan: ${candidates.length} candidates · ${fired} fired · ${watching} watching · regime SPY ${baseCtx.spyTrend}/QQQ ${baseCtx.qqqTrend} · VIX≈${baseCtx.vix} · F&G ${baseCtx.fearGreed}`);
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
