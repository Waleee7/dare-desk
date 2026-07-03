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
  color: string;
}

export function levelLines(levels: KeyLevels | null): LevelLine[] {
  if (!levels) return [];
  const out: LevelLine[] = [];
  if (levels.callWall != null) out.push({ price: levels.callWall, title: 'call wall', color: '#d4af37' });
  if (levels.putWall != null) out.push({ price: levels.putWall, title: 'put wall', color: '#d4af37' });
  if (levels.prevDayHigh != null) out.push({ price: levels.prevDayHigh, title: 'PDH', color: '#9b9ba4' });
  if (levels.prevDayLow != null) out.push({ price: levels.prevDayLow, title: 'PDL', color: '#9b9ba4' });
  for (const r of levels.resistance.slice(0, 2)) out.push({ price: r, title: 'R', color: '#f87171' });
  for (const s of levels.support.slice(0, 2)) out.push({ price: s, title: 'S', color: '#34d399' });
  // Dedupe lines that sit on top of each other (walls often == resistance).
  const seen = new Set<number>();
  return out.filter((l) => {
    const key = Math.round(l.price * 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function PriceChart({ bars, lines }: { bars: Bar[]; lines: LevelLine[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0d0d0f' },
        textColor: '#9b9ba4',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: '#232329' },
      timeScale: { borderColor: '#232329', timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelBackgroundColor: '#d4af37' }, vertLine: { labelBackgroundColor: '#d4af37' } },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#34d399', downColor: '#f87171',
      wickUpColor: '#34d399', wickDownColor: '#f87171',
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
    volume.setData(clean.map((b) => ({
      time: Math.floor(b.t / 1000) as UTCTimestamp,
      value: b.v,
      color: b.c >= b.o ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)',
    })));

    // Only draw lines that live inside the visible price range — a wall 10%
    // away would crush the candles into a ribbon.
    if (clean.length) {
      const lo = Math.min(...clean.map((b) => b.l));
      const hi = Math.max(...clean.map((b) => b.h));
      const pad = (hi - lo) * 0.25;
      for (const line of lines) {
        if (line.price < lo - pad || line.price > hi + pad) continue;
        candles.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.title,
        });
      }
    }

    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [bars, lines]);

  return <div ref={hostRef} className="chart-host" />;
}
