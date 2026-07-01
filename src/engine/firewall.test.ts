import { describe, it, expect } from 'vitest';
import { runFirewall, freshDay } from './firewall.js';
import type { TradeIdea, GovernorDecision, Grade, FactorScore, FactorName } from '../lib/types.js';

function decision(grade: Grade, confidence: number): GovernorDecision {
  const mk = (score: number): FactorScore => ({ factor: 'technical', score, rationale: '', flags: [], source: 'heuristic' });
  const factors = {
    technical: mk(70), joshLens: mk(70), regime: mk(70), news: mk(70), optionsChain: mk(70), riskReward: mk(70),
  } as Record<FactorName, FactorScore>;
  return { grade, total: confidence, confidence, breakdown: { factors, total: confidence, confidence, confluenceCount: 6 }, reasons: [] };
}

function idea(over: Partial<TradeIdea> = {}): TradeIdea {
  return {
    alertId: 'x', ticker: 'AAPL', direction: 'long', setup: 'test',
    contract: { ticker: 'AAPL', optionType: 'call', strike: 100, expiry: '2026-07-10', dte: 3 },
    entry: 100, stop: 99, targets: [102, 104], premium: 1.0, timeframe: 'intraday', tier: 'focus', ...over,
  };
}

// 10:00 ET weekday — outside lunch, before the 0DTE flat-by.
const MORNING = Date.parse('2026-07-01T14:00:00Z');

describe('firewall discipline gates', () => {
  it('approves a clean Focus A setup', () => {
    expect(runFirewall(idea(), decision('A', 82), freshDay('2026-07-01'), MORNING).approved).toBe(true);
  });

  it('blocks Extended-universe below A+ (needs >=90)', () => {
    const fw = runFirewall(idea({ tier: 'extended', ticker: 'PLTR' }), decision('A', 82), freshDay('2026-07-01'), MORNING);
    expect(fw.approved).toBe(false);
    expect(fw.blocks.some((b) => b.includes('extended_below_A+'))).toBe(true);
  });

  it('allows Extended at A+', () => {
    expect(runFirewall(idea({ tier: 'extended', ticker: 'PLTR' }), decision('A+', 92), freshDay('2026-07-01'), MORNING).approved).toBe(true);
  });

  it('blocks C and D grades', () => {
    expect(runFirewall(idea(), decision('C', 65), freshDay('2026-07-01'), MORNING).approved).toBe(false);
    expect(runFirewall(idea(), decision('D', 40), freshDay('2026-07-01'), MORNING).approved).toBe(false);
  });

  it('enforces the correlation heat cap', () => {
    const day = freshDay('2026-07-01');
    day.openClusters['mega-tech:long'] = 2; // AAPL cluster already full
    expect(runFirewall(idea(), decision('A', 82), day, MORNING).blocks.some((b) => b.includes('correlation_heat'))).toBe(true);
  });

  it('enforces the name-level cooldown', () => {
    const day = freshDay('2026-07-01');
    day.cooldownByTicker['AAPL'] = MORNING + 60_000;
    expect(runFirewall(idea(), decision('A', 82), day, MORNING).blocks.some((b) => b.includes('name_cooldown'))).toBe(true);
  });

  it('suppresses lunch chop (11:30-13:30 ET)', () => {
    const noon = Date.parse('2026-07-01T16:00:00Z'); // 12:00 ET
    expect(runFirewall(idea(), decision('A', 82), freshDay('2026-07-01'), noon).blocks.some((b) => b.includes('lunch'))).toBe(true);
  });

  it('blocks new 0DTE after the flat-by time', () => {
    const late = Date.parse('2026-07-01T20:00:00Z'); // 16:00 ET (>=15:55)
    const zeroDte = idea({ contract: { ticker: 'AAPL', optionType: 'call', strike: 100, expiry: '2026-07-01', dte: 0 } });
    expect(runFirewall(zeroDte, decision('A', 82), freshDay('2026-07-01'), late).blocks.some((b) => b.includes('0DTE'))).toBe(true);
  });

  it('chase guard blocks when price ran past the entry zone', () => {
    const fw = runFirewall(idea(), decision('A', 82), freshDay('2026-07-01'), MORNING, 101); // 1% past entry(100) > 0.4%
    expect(fw.blocks.some((b) => b.includes('chased'))).toBe(true);
  });
});
