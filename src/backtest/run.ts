// Backtest CLI — `npm run backtest`. Replays history through the live pipeline
// and prints an evidence report. Uses REAL Alpaca history when keys are set
// (BACKTEST_DAYS sessions back), else deterministic synthetic history so it runs
// fully offline. Reaches the 100-trade prove-it sample in seconds, not months —
// then any rule change can be re-validated against the same tape before it ships.

import { runBacktest } from './runner.js';
import { synthHistory, alpacaHistory } from './history.js';
import { fullUniverse } from '../scan/universe.js';
import { config } from '../lib/config.js';
import { claimsAllowed } from './index.js';

const signedR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;

async function main(): Promise<void> {
  const days = Number(process.env.BACKTEST_DAYS ?? 20);
  const hasKeys = config.alpaca.key.length > 0 && config.alpaca.secret.length > 0;
  const universe = fullUniverse();

  console.log(`\n📼 DARE Desk — Backtest Replay`);
  console.log(`   source: ${hasKeys ? 'Alpaca (real history)' : 'synthetic (no keys — offline)'} · ${days} sessions · ${universe.length} names\n`);

  let store;
  if (hasKeys) {
    const end = new Date();
    const start = new Date(end.getTime() - (days + 6) * 86_400_000); // +buffer for weekends
    store = await alpacaHistory(universe, start.toISOString(), end.toISOString());
  } else {
    store = synthHistory({ symbols: universe, days });
  }

  // Strict A+/A on real data; on the synthetic (no-keys) demo also measure the
  // watch line so the tool shows a full sample. BACKTEST_WATCH=true forces it on.
  const includeWatch = !hasKeys || (process.env.BACKTEST_WATCH ?? '').toLowerCase() === 'true';
  if (includeWatch) console.log(`   fire set: A+/A + B watch line (sample-building mode)\n`);

  const report = await runBacktest({
    store,
    stepMinutes: Number(process.env.BACKTEST_STEP ?? 5),
    fireGrades: includeWatch ? ['A+', 'A', 'B'] : ['A+', 'A'],
    onDay: (date, closed) => console.log(`   ${date} — ${closed} trade(s) closed`),
  });

  const e = report.expectancy;
  console.log(`\n─── RESULTS · ${report.span.start} → ${report.span.end} ───`);
  console.log(`   ticks ${report.ticks} · fired ${report.signalsFired} · closed ${e.trades}`);
  if (e.trades > 0) {
    console.log(`   expectancy ${signedR(e.expectancyR)} · win ${(e.winRate * 100).toFixed(0)}% · PF ${e.profitFactor} · avg hold ${e.avgHoldMinutes}m`);
    console.log(`   by regime — up ${signedR(e.byRegime.up.expectancyR)} (${e.byRegime.up.trades}) · down ${signedR(e.byRegime.down.expectancyR)} (${e.byRegime.down.trades}) · flat ${signedR(e.byRegime.flat.expectancyR)} (${e.byRegime.flat.trades})`);
    console.log(`\n   by setup:`);
    for (const s of report.bySetup) {
      console.log(`     ${signedR(s.expectancyR).padStart(7)} · ${String(s.trades).padStart(3)} trades · ${((s.wins / s.trades) * 100).toFixed(0).padStart(3)}% win · ${s.setup}`);
    }
  }
  const proven = claimsAllowed(e);
  console.log(`\n   prove-it gate: ${proven ? '✅ PASSED' : `🔒 ${e.trades}/${config.risk.minPaperTrades} — evidence only, no claims`}`);
  console.log(`   (modeled fills incl. theta + real/estimated spreads — estimates, not live execution)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
