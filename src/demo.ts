// Component 9 — Hackathon Demo Mode. Walks the judge story end to end:
//   old bot missed a setup → Josh marks it → new bot scores it →
//   risk firewall checks it → Discord alert fires → paper trade logs →
//   journal learns.  Runs offline (heuristic scorers) with no API key.

// Use a realistic demo account so risk-based sizing produces real contract
// counts (set before importing config). Override via .env if you prefer.
process.env.ACCOUNT_SIZE_USD ||= '50000';

const { PremiumFloorEngine } = await import('./pipeline.js');
const { config, hasLLM } = await import('./lib/config.js');
type MarketContext = import('./lib/types.js').MarketContext;

function ctx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    asOf: new Date().toISOString(),
    spyTrend: 'up', qqqTrend: 'up', vix: 15, vixTrend: 'flat',
    breadth: 0.4, fearGreed: 62, putCallRatio: 0.85,
    headlines: ['Megacaps lead a broad-based rally', 'Yields ease after soft data'],
    eventRiskToday: false, earningsSoon: false,
    ...over,
  };
}

function hr(title: string) { console.log(`\n${'═'.repeat(64)}\n${title}\n${'═'.repeat(64)}`); }

const engine = new PremiumFloorEngine();

hr(`${config.botName.toUpperCase()} — DECISION ENGINE DEMO`);
console.log(hasLLM()
  ? `LLM scoring ON (model: ${config.scorerModel})`
  : 'LLM scoring OFF — running deterministic heuristics (no API key). Pipeline still fully runs.');
console.log(`Account: $${config.risk.accountSizeUsd.toLocaleString()} · max risk/trade ${config.risk.maxRiskPerTradePct}%`);

// 1) A clean play in a friendly regime — should grade high and fire.
hr('1) BOT ALERT — clean unusual-flow call in a risk-on tape');
const r1 = await engine.evaluate(
  'SPY 580C 6/20 — unusual call flow sweeping the ask. Entry 578, stop 576, targets 582 / 585. premium 2.10',
  ctx(),
);
console.log(r1.alert.text);
console.log(`\n[broker] ${r1.broker?.message ?? '—'}`);

// 2) The setup the OLD bot stayed silent on — Josh sees it; the lens catches it.
hr('2) "SEE WHAT JOSH SEES" — old bot was silent; Josh-lens + regime promote it');
const r2 = await engine.evaluate(
  'QQQ 505C 6/20 failed breakdown + VWAP reclaim, relative strength vs SPY. Entry 503, stop 501.5, targets 507 / 510. premium 3.40',
  ctx({ breadth: 0.55 }),
);
engine.annotate('Classic failed-breakdown reclaim — I take this every time when QQQ leads.');
console.log(r2.alert.text);
console.log(`\n[broker] ${r2.broker?.message ?? '—'}`);

// 3) A trap the firewall must block — earnings event risk + no stop.
hr('3) FIREWALL BLOCK — discipline over FOMO (earnings into the trade, no stop)');
const r3 = await engine.evaluate(
  'NVDA 140C calls — momentum into earnings tomorrow. Entry 138, no stop, target 150. premium 6.80',
  ctx({ earningsSoon: true, headlines: ['NVDA reports after the bell tomorrow'] }),
);
console.log(r3.alert.text);

// 4) The journal learns from all three.
hr('JOURNAL — what the bot logged & learned');
const s = engine.journal.summary();
console.log(`Entries: ${s.total}  ·  alerted ${s.alerted} / watch ${s.watched} / skipped ${s.skipped}`);
console.log(`Top block reasons: ${s.topBlocks.join(', ') || 'none'}`);
for (const e of engine.journal.all()) {
  console.log(`  • ${e.ticker} ${e.setup} → ${e.grade} (${e.confidence}% conf, raw ${e.total}/100) [${e.outcome}]`
    + (e.mistakeTags.length ? `  tags: ${e.mistakeTags.join(', ')}` : '')
    + (e.ruleIdea ? `\n      ↳ rule idea: ${e.ruleIdea}` : ''));
}
console.log('\nDemo complete. Paper-first, explainable, disciplined.\n');
