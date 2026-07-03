import { describe, it, expect } from 'vitest';
import { runFirewall, freshDay, recordTradeResult } from './firewall.js';
import { SignalRegistry } from './signalRegistry.js';
import type { TradeIdea, GovernorDecision, Grade, FactorScore, FactorName } from '../lib/types.js';
import { thetaBleed, premiumNow, premiumAt } from '../scan/contracts.js';
import { classifyFrom, vwapCrosses } from '../context/dayType.js';
import { snapExpiry, isTradeable, selectRealContract } from '../scan/contractSelect.js';
import type { ChainSnapshot, StrikeQuote } from '../options/provider.js';

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

const MORNING = Date.parse('2026-07-01T14:00:00Z'); // 10:00 ET

describe('aggregate exposure gates', () => {
  it('blocks when max open positions is reached', () => {
    const day = { ...freshDay('2026-07-01'), openPositionsCount: 5 };
    const fw = runFirewall(idea(), decision('A', 82), day, MORNING);
    expect(fw.blocks.some((b) => b.includes('max_open_positions'))).toBe(true);
  });

  it('blocks when total at-stop risk would exceed the cap', () => {
    // $10k account, 3% cap = $300. $250 at-stop on + ~$100 more (2x of a $1.00
    // premium at the 40% intraday stop × 1.25 haircut) breaches it.
    const day = { ...freshDay('2026-07-01'), openRiskUsd: 250, openPositionsCount: 2 };
    const fw = runFirewall(idea(), decision('A', 82), day, MORNING);
    expect(fw.blocks.some((b) => b.includes('open_risk_cap'))).toBe(true);
  });

  it('never sizes a signal to zero — the contract is the contract', () => {
    // $3.50 premium: full-premium sizing would zero this out; suggestion floors at 1.
    const fw = runFirewall(idea({ premium: 3.5 }), decision('A', 82), freshDay('2026-07-01'), MORNING);
    expect(fw.approved).toBe(true);
    expect(fw.positionContracts).toBe(1);
  });

  it('leans in on A+ conviction', () => {
    const a = runFirewall(idea(), decision('A', 85), freshDay('2026-07-01'), MORNING);
    const aplus = runFirewall(idea(), decision('A+', 92), freshDay('2026-07-01'), MORNING);
    expect(aplus.positionContracts).toBeGreaterThan(a.positionContracts);
  });

  it('allows when under both caps', () => {
    const day = { ...freshDay('2026-07-01'), openRiskUsd: 100, openPositionsCount: 2 };
    expect(runFirewall(idea(), decision('A', 82), day, MORNING).approved).toBe(true);
  });
});

describe('profit lock + stand-down', () => {
  it('stands down after giving back half of a +2% day', () => {
    // Peaked +$250 (>2% of $10k = $200), realized back to +$100 (< 50% of peak).
    const day = { ...freshDay('2026-07-01'), peakPnlUsd: 250, realizedPnlUsd: 100 };
    const fw = runFirewall(idea(), decision('A', 82), day, MORNING);
    expect(fw.blocks.some((b) => b.includes('profit_lock'))).toBe(true);
  });

  it('keeps trading while the green holds', () => {
    const day = { ...freshDay('2026-07-01'), peakPnlUsd: 250, realizedPnlUsd: 200 };
    expect(runFirewall(idea(), decision('A', 82), day, MORNING).approved).toBe(true);
  });

  it('honors a stand-down reason (weekly breaker)', () => {
    const day = { ...freshDay('2026-07-01'), standDownReason: 'weekly breaker: -700 over 5 sessions' };
    const fw = runFirewall(idea(), decision('A', 82), day, MORNING);
    expect(fw.blocks.some((b) => b.includes('stand_down'))).toBe(true);
  });

  it('half-sizes on the day multiplier', () => {
    const full = runFirewall(idea(), decision('A', 82), freshDay('2026-07-01'), MORNING);
    const half = runFirewall(idea(), decision('A', 82), { ...freshDay('2026-07-01'), sizeMultiplier: 0.5 }, MORNING);
    expect(half.positionContracts).toBeLessThan(full.positionContracts);
  });
});

describe('escalating loss-streak cooldown', () => {
  it('second streak of the day stands down through the close', () => {
    let day = freshDay('2026-07-01');
    // First streak: two losses → normal 45m cooldown.
    day = recordTradeResult(day, -50, MORNING);
    day = recordTradeResult(day, -50, MORNING);
    expect(day.cooldownCount).toBe(1);
    const firstCooldown = day.cooldownUntil!;
    expect(firstCooldown - MORNING).toBeLessThanOrEqual(45 * 60_000);
    // Second streak: done for the day (cooldown reaches at least the close).
    day = recordTradeResult(day, -50, MORNING);
    day = recordTradeResult(day, -50, MORNING);
    expect(day.cooldownCount).toBe(2);
    expect(day.cooldownUntil! - MORNING).toBeGreaterThan(45 * 60_000);
  });

  it('no longer double-counts tradesToday on close', () => {
    const day = recordTradeResult({ ...freshDay('2026-07-01'), tradesToday: 3 }, 50, MORNING);
    expect(day.tradesToday).toBe(3); // increments at open, not at close
  });

  it('tracks the peak for the profit lock', () => {
    let day = recordTradeResult(freshDay('2026-07-01'), 250, MORNING);
    expect(day.peakPnlUsd).toBe(250);
    day = recordTradeResult(day, -100, MORNING);
    expect(day.peakPnlUsd).toBe(250);
    expect(day.realizedPnlUsd).toBe(150);
  });
});

describe('0DTE gamma windows', () => {
  const zeroDte = () => idea({ contract: { ticker: 'AAPL', optionType: 'call', strike: 100, expiry: '2026-07-01', dte: 0 }, timeframe: 'scalp' });
  it('allows the open drive (10:00 ET)', () => {
    const fw = runFirewall(zeroDte(), decision('A', 82), freshDay('2026-07-01'), MORNING);
    expect(fw.blocks.some((b) => b.includes('gamma_window'))).toBe(false);
  });
  it('blocks the dead drift (13:45 ET)', () => {
    const drift = Date.parse('2026-07-01T17:45:00Z'); // 13:45 ET
    const fw = runFirewall(zeroDte(), decision('A', 82), freshDay('2026-07-01'), drift);
    expect(fw.blocks.some((b) => b.includes('gamma_window'))).toBe(true);
  });
});

describe('theta model', () => {
  it('bleeds harder late-day on 0DTE', () => {
    const early = thetaBleed(2.0, 'scalp', 0, 20, 360); // opened 10:00, held 20m
    const late = thetaBleed(2.0, 'scalp', 0, 20, 60); // opened 15:00, held 20m
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
  });
  it('a stalled hold decays below entry (no more free time stops)', () => {
    const marked = premiumNow(2.0, 0.5, 0, 'scalp', true, { dte: 0, elapsedMin: 20, minutesToCloseAtEntry: 120 });
    expect(marked).toBeLessThan(2.0);
  });
  it('caps the favorable gain at $1 per $1 of underlying move', () => {
    const p = premiumAt(2.0, 0.5, 50, 'scalp', true); // huge move, gamma would over-credit
    expect(p - 2.0).toBeLessThanOrEqual(50 + 1e-9);
  });
});

describe('signal registry', () => {
  it('locks a re-fire of the same setup, allows a grade upgrade', () => {
    const reg = new SignalRegistry();
    expect(reg.considerFire('NVDA', 'Range breakout', 'long', 'A', 0)).toBeNull();
    expect(reg.considerFire('NVDA', 'Range breakout', 'long', 'A', 10 * 60_000)).toContain('duplicate_signal');
    expect(reg.considerFire('NVDA', 'Range breakout', 'long', 'A+', 12 * 60_000)).toBeNull(); // upgraded
    expect(reg.considerFire('NVDA', 'Range breakout', 'long', 'A', 46 * 60_000 + 12 * 60_000)).toBeNull(); // lock expired
  });
  it('never re-fires a ticker+direction with a position on', () => {
    const reg = new SignalRegistry();
    reg.markOpen('NVDA', 'long');
    expect(reg.considerFire('NVDA', 'VWAP reclaim', 'long', 'A+', 0)).toContain('position already on');
    reg.markClosed('NVDA', 'long');
    expect(reg.considerFire('NVDA', 'VWAP reclaim', 'long', 'A+', 0)).toBeNull();
  });
  it('rate-limits watch repeats to one per hour', () => {
    const reg = new SignalRegistry();
    expect(reg.considerWatch('TSLA', 'Momentum continuation (0DTE)', 'long', 0)).toBeNull();
    expect(reg.considerWatch('TSLA', 'Momentum continuation (0DTE)', 'long', 30 * 60_000)).toContain('duplicate_watch');
    expect(reg.considerWatch('TSLA', 'Momentum continuation (0DTE)', 'long', 61 * 60_000)).toBeNull();
  });
});

describe('day-type classifier', () => {
  it('calls a trend day on range expansion with few VWAP crosses', () => {
    expect(classifyFrom({ sessionMin: 120, todayRange: 6, avgDailyRange: 5, crosses: 1, direction: 1 })).toBe('trend-up');
    expect(classifyFrom({ sessionMin: 120, todayRange: 6, avgDailyRange: 5, crosses: 1, direction: -1 })).toBe('trend-down');
  });
  it('calls chop on repeated VWAP crossings whatever the range', () => {
    expect(classifyFrom({ sessionMin: 120, todayRange: 6, avgDailyRange: 5, crosses: 6, direction: 1 })).toBe('range');
  });
  it('calls range on a compressed tape', () => {
    expect(classifyFrom({ sessionMin: 180, todayRange: 1, avgDailyRange: 5, crosses: 2, direction: 0 })).toBe('range');
  });
  it('stays forming early', () => {
    expect(classifyFrom({ sessionMin: 20, todayRange: 2, avgDailyRange: 5, crosses: 0, direction: 1 })).toBe('forming');
  });
  it('counts VWAP crossings', () => {
    const bar = (c: number) => ({ o: c, h: c + 0.1, l: c - 0.1, c, v: 1000 });
    // steadily above, one dip below the running VWAP and back = 2 crossings
    const bars = [bar(100), bar(101), bar(102), bar(96), bar(103)];
    expect(vwapCrosses(bars)).toBeGreaterThanOrEqual(2);
  });
});

describe('real contract selection', () => {
  const q = (strike: number, type: 'call' | 'put', over: Partial<StrikeQuote> = {}): StrikeQuote => ({
    strike, type, bid: 2.0, ask: 2.1, mid: 2.05, iv: 0.4, openInterest: 1000, volume: 500, spreadPct: 4.9, ...over,
  });
  const chain = (over: Partial<ChainSnapshot> = {}): ChainSnapshot => ({
    ticker: 'NVDA', delayed: true, asOf: '', spot: 100, expiry: '2026-07-02',
    expirations: ['2026-07-02', '2026-07-06', '2026-07-10'],
    quotes: [q(99, 'call'), q(100, 'call'), q(101, 'call', { openInterest: 5, volume: 2, spreadPct: 25, bid: 1.5, ask: 2.0, mid: 1.75 })],
    unusualStrikes: [], highestVolumeStrikes: [], putCallVolRatio: null, gammaMagnets: [],
    callWall: null, putWall: null, netFlowBias: 'mixed', note: '', ...over,
  });
  const NOW = new Date('2026-07-02T16:00:00Z'); // 12:00 ET Thursday

  it('snaps a target DTE to the nearest LISTED expiry only', () => {
    const s = snapExpiry(3, ['2026-07-02', '2026-07-06', '2026-07-10'], NOW);
    expect(s!.expiry).toBe('2026-07-06'); // 3DTE target → the 4-day listed weekly, not a fake Thursday+3
    expect(snapExpiry(0, ['2026-07-02', '2026-07-06'], NOW)!.dte).toBe(0);
    expect(snapExpiry(0, ['2026-06-26'], NOW)).toBeNull(); // past expiries never count
  });

  it('screens illiquid strikes', () => {
    expect(isTradeable(q(100, 'call'))).toBe(true);
    expect(isTradeable(q(100, 'call', { openInterest: 10, volume: 5 }))).toBe(false);
    expect(isTradeable(q(100, 'call', { spreadPct: 20 }))).toBe(false);
  });

  it('anchors to the real mid and steps past illiquid strikes', () => {
    const sel = selectRealContract({
      ticker: 'NVDA', price: 101, optionType: 'call', horizon: 'intraday',
      chain: chain({ expiry: '2026-07-06' }), realtimeData: true, now: NOW, // 3DTE target snaps to the 07-06 weekly
    });
    expect(sel.source).toBe('chain');
    expect(sel.contract.strike).toBe(100); // 101 strike is illiquid — stepped to 100
    expect(sel.contract.bid).toBeDefined();
    expect(sel.premium).toBeGreaterThan(2.05); // delay-corrected UP: live 101 > chain spot 100
  });

  it('falls back to the model on mock data or no chain', () => {
    expect(selectRealContract({ ticker: 'NVDA', price: 100, optionType: 'call', horizon: 'scalp', chain: chain(), realtimeData: false }).source).toBe('model');
    expect(selectRealContract({ ticker: 'NVDA', price: 100, optionType: 'call', horizon: 'scalp', chain: null, realtimeData: true }).source).toBe('model');
  });
});
