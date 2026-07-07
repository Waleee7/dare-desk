// Entry point. Evaluate a single alert passed as an argument, or print usage.
//   npm start -- "SPY 580C 6/20 unusual flow, entry 578 stop 576 targets 582 585"

import type { MarketContext } from './lib/types.js';
import { DareDeskEngine } from './pipeline.js';

function neutralContext(): MarketContext {
  return {
    asOf: new Date().toISOString(),
    spyTrend: 'flat', qqqTrend: 'flat', vix: 18, vixTrend: 'flat',
    breadth: 0, fearGreed: 50, headlines: [], eventRiskToday: false, earningsSoon: false,
  };
}

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.log('Usage: npm start -- "<alert text>"   |   npm run demo');
    return;
  }
  const engine = new DareDeskEngine();
  const { alert, broker } = await engine.evaluate(text, neutralContext());
  console.log(alert.text);
  if (broker) console.log(`\n[broker] ${broker.message}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
