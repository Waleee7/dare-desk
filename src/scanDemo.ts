// Active-scanner run. Scans the universe (live Alpaca feed if keys are set,
// else mock), runs each candidate through the decision engine, posts confident
// signals to Discord, and persists data/state.json for the dashboard.

process.env.ACCOUNT_SIZE_USD ||= '50000';

const { PremiumFloorEngine } = await import('./pipeline.js');
const { Scanner } = await import('./scan/scanner.js');
const { makeProvider } = await import('./data/index.js');
const { buildMarketContext } = await import('./context/marketContext.js');
const { dispatchSignal } = await import('./discord/dispatch.js');
const { writeState, rowFrom, dashboardMeta } = await import('./lib/state.js');
const { config, hasLLM } = await import('./lib/config.js');
const { fullUniverse } = await import('./scan/universe.js');
const { makeCalendarProvider } = await import('./calendar/index.js');
type SignalRow = import('./lib/state.js').SignalRow;

// Placeholder headlines for the dashboard news bar (real news feed = next).
const HEADLINES = [
  'Indices grind higher on broad participation',
  'Semis lead; MU in focus ahead of cycle data',
  'VIX subdued — risk-on tape into the afternoon',
];

const hr = (t: string) => console.log(`\n${'═'.repeat(64)}\n${t}\n${'═'.repeat(64)}`);

const provider = makeProvider();
hr(`${config.botName.toUpperCase()} — ACTIVE SCANNER RUN`);
console.log(hasLLM() ? `LLM scoring ON (${config.scorerModel})` : 'LLM scoring OFF — deterministic heuristics.');
console.log(`Data feed: ${provider.name}${provider.realtime ? ' (real-time)' : ' (mock — add ALPACA keys for live)'}`);
console.log(`Universe (${fullUniverse().length}): ${fullUniverse().join(', ')}`);

const scanner = new Scanner(provider);
const engine = new PremiumFloorEngine();

// Today's REAL market context (regime/breadth/vol/Fear&Greed) from live data.
const baseCtx = await buildMarketContext(provider, fullUniverse());
console.log(`Today's regime: SPY ${baseCtx.spyTrend} · QQQ ${baseCtx.qqqTrend} · VIX≈${baseCtx.vix} · breadth ${baseCtx.breadth} · Fear&Greed ${baseCtx.fearGreed}`);

const candidates = await scanner.scanOnce(0.5, baseCtx.vix);
hr(`SCAN PASS — ${candidates.length} candidate setup(s)`);

const rows: SignalRow[] = [];
let fired = 0;
const headlines = baseCtx.headlines.length ? baseCtx.headlines : HEADLINES;
const earners = await makeCalendarProvider().earningsFor(fullUniverse());
for (const idea of candidates) {
  const ctx = { ...baseCtx, earningsSoon: earners.has(idea.ticker.toUpperCase()) };
  const res = await engine.evaluateIdea(idea, ctx);
  rows.push(rowFrom(res));
  const tag = `${idea.ticker} ${idea.setup} [${idea.timeframe}]`;
  const routed = await dispatchSignal(res);
  if (routed === 'signal') { fired++; console.log(`✅ SIGNAL  ${tag} → ${res.decision.grade} (${res.decision.total}/100)`); }
  else if (routed === 'watch') console.log(`👀 WATCH   ${tag} → WATCH (${res.decision.total}/100)`);
  else console.log(`·  pass    ${tag} → ${res.decision.grade} (${res.decision.total}): ${res.firewall.blocks[0] ?? '—'}`);
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
  headlines,
  meta: dashboardMeta(),
  expectancy,
  proveIt: { proven: expectancy.proven, paperTrades: expectancy.trades, needed: config.risk.minPaperTrades },
});

hr('RESULT');
console.log(`Scanned ${fullUniverse().length} · ${candidates.length} candidates · ${fired} fired · ${candidates.length - fired} filtered.`);
console.log('Wrote data/state.json → open the dashboard to see it.\n');
