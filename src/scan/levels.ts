// Key levels — where the walls are. Combines three honest sources:
//   1. Price structure: swing highs/lows from recent bars + prior-day H/L/C.
//   2. Volume profile: the prices where the most volume actually traded (nodes).
//   3. Options positioning (DELAYED chain): call/put walls + gamma magnets —
//      the strikes dealer hedging pins price toward and stalls it at.
// Targets get SNAPPED to these: a long's take-profit sits just UNDER the wall
// it has to fight through, not hopefully past it. That is the difference between
// banking the move you actually get and round-tripping a winner.

import type { Bar } from '../data/provider.js';
import type { Direction, KeyLevels } from '../lib/types.js';
import type { ChainSnapshot } from '../options/provider.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Swing pivots: a bar whose high (low) tops (bottoms) its k neighbors each side. */
export function swingLevels(bars: Bar[], k = 3): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const b = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j]!.h >= b.h) isHigh = false;
      if (bars[j]!.l <= b.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(round2(b.h));
    if (isLow) lows.push(round2(b.l));
  }
  return { highs, lows };
}

/** Volume profile nodes: bucket the range, sum volume at each bar's typical
 *  price, return the top peak prices (most-traded areas = real support/resistance). */
export function volumeNodes(bars: Bar[], bins = 24, top = 3): number[] {
  if (bars.length < 5) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) { if (b.l < min) min = b.l; if (b.h > max) max = b.h; }
  if (!(max > min)) return [];
  const width = (max - min) / bins;
  const vol = new Array<number>(bins).fill(0);
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((typical - min) / width)));
    vol[idx]! += b.v;
  }
  return vol
    .map((v, i) => ({ v, price: round2(min + (i + 0.5) * width) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, top)
    .map((n) => n.price);
}

/** Dedupe levels that sit within `tolPct`% of each other (keep the first = strongest). */
function dedupe(levels: number[], tolPct: number): number[] {
  const out: number[] = [];
  for (const l of levels) {
    if (!out.some((o) => Math.abs(o - l) / o * 100 < tolPct)) out.push(l);
  }
  return out;
}

export interface LevelsInput {
  ticker: string;
  price: number;
  intraday: Bar[]; // 15m bars (structure)
  daily: Bar[]; // daily bars (prior-day levels + bigger volume nodes)
  chain: ChainSnapshot | null; // delayed chain (walls) — null degrades gracefully
}

/** Assemble the level map for a ticker. Pure — no I/O. */
export function computeKeyLevels(inp: LevelsInput): KeyLevels {
  const { ticker, price, intraday, daily, chain } = inp;
  const pd = daily.length >= 2 ? daily[daily.length - 2] : undefined;

  const sw = swingLevels(intraday);
  const nodes = [...volumeNodes(intraday), ...volumeNodes(daily, 24, 2)];

  const candidates: number[] = [
    ...sw.highs, ...sw.lows, ...nodes,
    ...(pd ? [round2(pd.h), round2(pd.l), round2(pd.c)] : []),
    ...(chain?.gammaMagnets ?? []),
    ...(chain?.callWall != null ? [chain.callWall] : []),
    ...(chain?.putWall != null ? [chain.putWall] : []),
  ].filter((l) => Number.isFinite(l) && l > 0);

  // Split around price, nearest-first, dedupe near-identical lines.
  const above = dedupe(candidates.filter((l) => l > price).sort((a, b) => a - b), 0.15).slice(0, 4);
  const below = dedupe(candidates.filter((l) => l < price).sort((a, b) => b - a), 0.15).slice(0, 4);

  return {
    ticker,
    asOf: new Date().toISOString(),
    price: round2(price),
    support: below,
    resistance: above,
    volumeNodes: dedupe(nodes.sort((a, b) => a - b), 0.15),
    callWall: chain?.callWall ?? null,
    putWall: chain?.putWall ?? null,
    gammaMagnets: chain?.gammaMagnets ?? [],
    prevDayHigh: pd ? round2(pd.h) : null,
    prevDayLow: pd ? round2(pd.l) : null,
    prevClose: pd ? round2(pd.c) : null,
  };
}

/**
 * Snap targets to the walls. For a long: if a resistance line sits between entry
 * and a target, the target pulls back to just UNDER that wall (front-run it —
 * everyone else's sell orders live there). Mirror for shorts. Targets stay in
 * order and never collapse through the entry.
 */
export function snapTargets(
  entry: number,
  targets: number[],
  direction: Direction,
  levels: KeyLevels,
): number[] {
  const buffer = Math.max(0.05, entry * 0.001); // stand ~0.1% in front of the wall
  const walls = direction === 'long' ? levels.resistance : levels.support;
  if (!walls.length) return targets;

  return targets.map((t) => {
    if (direction === 'long') {
      // Nearest wall strictly between entry and target — snap to just below it.
      const inPath = walls.filter((w) => w > entry + buffer && w < t).sort((a, b) => a - b);
      const wall = inPath[0];
      if (wall != null) {
        const snapped = round2(wall - buffer);
        return snapped > entry ? snapped : t;
      }
      return t;
    }
    const inPath = walls.filter((w) => w < entry - buffer && w > t).sort((a, b) => b - a);
    const wall = inPath[0];
    if (wall != null) {
      const snapped = round2(wall + buffer);
      return snapped < entry ? snapped : t;
    }
    return t;
  });
}

/** Compact human line: "R: 618.5 · 620 | S: 615.2 · putW 610". For alerts + LLM. */
export function levelsLine(levels: KeyLevels): string {
  const fmt = (arr: number[]) => arr.slice(0, 2).map(String).join(' · ') || '—';
  const walls = [
    levels.callWall != null ? `callW ${levels.callWall}` : null,
    levels.putWall != null ? `putW ${levels.putWall}` : null,
  ].filter(Boolean).join(' / ');
  return `R: ${fmt(levels.resistance)} | S: ${fmt(levels.support)}${walls ? ` | ${walls}` : ''}`;
}
