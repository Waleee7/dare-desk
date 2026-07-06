'use client';

// Candlestick + volume chart (lightweight-charts v5) with the intelligence layer
// drawn ON the chart: prev-day levels, support/resistance, and the options walls
// as dashed price lines. The chart is the map; the walls are the terrain.

import { useEffect, useRef } from 'react';
import {
  createChart, CandlestickSeries, HistogramSeries, ColorType, LineStyle,
  type IChartApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, KeyLevels } from '../lib/types';

export interface LevelLine {
  price: number;
  title: string;
  kind: 'wall' | 'pd' | 'res' | 'sup'; // resolved to the active theme's colors at draw time
}

export function levelLines(levels: KeyLevels | null): LevelLine[] {
  if (!levels) return [];
  const out: LevelLine[] = [];
  if (levels.callWall != null) out.push({ price: levels.callWall, title: 'call wall', kind: 'wall' });
  if (levels.putWall != null) out.push({ price: levels.putWall, title: 'put wall', kind: 'wall' });
  if (levels.prevDayHigh != null) out.push({ price: levels.prevDayHigh, title: 'PDH', kind: 'pd' });
  if (levels.prevDayLow != null) out.push({ price: levels.prevDayLow, title: 'PDL', kind: 'pd' });
  for (const r of levels.resistance.slice(0, 2)) out.push({ price: r, title: 'R', kind: 'res' });
  for (const s of levels.support.slice(0, 2)) out.push({ price: s, title: 'S', kind: 'sup' });
  // Dedupe lines that sit on top of each other (walls often == resistance).
  const seen = new Set<number>();
  return out.filter((l) => {
    const key = Math.round(l.price * 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read a theme token off the live DOM — the chart follows whatever theme is on. */
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export default function PriceChart({ bars, lines, mode }: { bars: Bar[]; lines: LevelLine[]; mode?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const up = cssVar('--up', '#0e7a4e');
    const down = cssVar('--down', '#c0392b');
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar('--chart-bg', '#ffffff') },
        textColor: cssVar('--ink-dim', '#5b665f'),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar('--chart-grid', 'rgba(255,255,255,0.04)') },
        horzLines: { color: cssVar('--chart-grid', 'rgba(255,255,255,0.04)') },
      },
      rightPriceScale: { borderColor: cssVar('--border', '#232329') },
      timeScale: { borderColor: cssVar('--border', '#232329'), timeVisible: true, secondsVisible: false },
      crosshair: {
        horzLine: { labelBackgroundColor: cssVar('--gold', '#d4af37') },
        vertLine: { labelBackgroundColor: cssVar('--gold', '#d4af37') },
      },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down,
      wickUpColor: up, wickDownColor: down,
      borderVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // Bars must be ascending + unique on time for the chart engine.
    const clean = [...bars]
      .sort((a, b) => a.t - b.t)
      .filter((b, i, arr) => i === 0 || b.t !== arr[i - 1]!.t);

    candles.setData(clean.map((b) => ({
      time: Math.floor(b.t / 1000) as UTCTimestamp,
      open: b.o, high: b.h, low: b.l, close: b.c,
    })));
    const volAlpha = (hex: string) => `${hex}59`; // ~35% alpha on the theme's up/down
    volume.setData(clean.map((b) => ({
      time: Math.floor(b.t / 1000) as UTCTimestamp,
      value: b.v,
      color: b.c >= b.o ? volAlpha(up) : volAlpha(down),
    })));

    // Only draw lines that live inside the visible price range — a wall 10%
    // away would crush the candles into a ribbon.
    if (clean.length) {
      const lo = Math.min(...clean.map((b) => b.l));
      const hi = Math.max(...clean.map((b) => b.h));
      const pad = (hi - lo) * 0.25;
      const lineColor: Record<LevelLine['kind'], string> = {
        wall: cssVar('--gold', '#a97b16'),
        pd: cssVar('--ink-dim', '#5b665f'),
        res: down,
        sup: up,
      };
      for (const line of lines) {
        if (line.price < lo - pad || line.price > hi + pad) continue;
        candles.createPriceLine({
          price: line.price,
          color: lineColor[line.kind],
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.title,
        });
      }
    }

    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [bars, lines, mode]);

  return <div ref={hostRef} className="chart-host" />;
}
