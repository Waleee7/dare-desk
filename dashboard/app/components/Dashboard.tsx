'use client';

// The shell — masthead (brand + LIVE/MOCK badge), status strip, tab bar, and the
// 15s polling loop. Tabs render below; every tab reads the same polled state.

import { useCallback, useEffect, useState } from 'react';
import type { DashboardState } from '../lib/types';
import { signedMoney, plClass } from '../lib/format';
import TodayTab from './TodayTab';
import ChartsTab from './ChartsTab';
import HistoryTab from './HistoryTab';
import PerformanceTab from './PerformanceTab';
import NewsTab from './NewsTab';

// Monochrome glyphs only — colorful emoji break the black/gold discipline.
const TABS = [
  { id: 'today', label: 'Today', ico: '◉' },
  { id: 'charts', label: 'Charts', ico: '∿' },
  { id: 'history', label: 'History', ico: '☰' },
  { id: 'performance', label: 'Performance', ico: '▦' },
  { id: 'news', label: 'News', ico: '≣' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<TabId>('today');
  const [chartTicker, setChartTicker] = useState<string>('SPY');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.status === 404) { setMissing(true); return; }
      if (!res.ok) return;
      setState((await res.json()) as DashboardState);
      setMissing(false);
    } catch {
      // poll again next interval
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  // Tap a ticker anywhere → jump to its chart.
  const openChart = useCallback((ticker: string) => {
    setChartTicker(ticker.toUpperCase());
    setTab('charts');
  }, []);

  if (missing) {
    return (
      <div className="shell">
        <Masthead state={null} />
        <div className="empty" style={{ marginTop: 40 }}>
          No scan data yet.<br />
          <span className="faint">Start the bot: <code>npm run go</code> (or <code>npm run scan</code> for one pass).</span>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Masthead state={state} />
      <StatusBar state={state} />
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="ico" aria-hidden>{t.ico}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {!state ? (
        <div className="empty" style={{ marginTop: 24 }}>Loading the desk…</div>
      ) : tab === 'today' ? <TodayTab state={state} onTicker={openChart} />
        : tab === 'charts' ? <ChartsTab state={state} ticker={chartTicker} onTicker={setChartTicker} />
        : tab === 'history' ? <HistoryTab state={state} />
        : tab === 'performance' ? <PerformanceTab state={state} />
        : <NewsTab state={state} />}
    </div>
  );
}

function Masthead({ state }: { state: DashboardState | null }) {
  const live = state ? !state.provider.includes('mock') : false;
  const ageMin = state ? (Date.now() - Date.parse(state.updatedAt)) / 60_000 : 0;
  const stale = state != null && ageMin > 6;
  return (
    <header className="masthead">
      <div className="brand"><span className="gold">◆</span> DARE <span className="gold">DESK</span></div>
      <div className="spacer" />
      {state && (
        stale ? (
          <span className="badge stale"><span className="dot" />IDLE · {Math.round(ageMin)}m</span>
        ) : live ? (
          <span className="badge live"><span className="dot" />LIVE DATA</span>
        ) : (
          <span className="badge mock"><span className="dot" />MOCK DATA</span>
        )
      )}
    </header>
  );
}

function StatusBar({ state }: { state: DashboardState | null }) {
  if (!state) return null;
  const d = state.day;
  const dayType = state.dayType;
  return (
    <div className="statusbar">
      {d && (
        <span>Day P/L <b className={`num ${plClass(d.realizedPnlUsd)}`}>{signedMoney(d.realizedPnlUsd)}</b></span>
      )}
      {d && <span>Positions <b className="num">{d.openPositionsCount}</b></span>}
      {dayType && (
        <span>Tape <b>{dayType === 'trend-up' ? 'trend ↑' : dayType === 'trend-down' ? 'trend ↓' : dayType}</b></span>
      )}
      <span>Prove-it <b className="num">{state.proveIt.paperTrades}/{state.proveIt.needed}</b></span>
      {d?.standDownReason && <span className="down">⛔ stand-down</span>}
      {d && d.sizeMultiplier < 1 && <span className="down">½ size</span>}
      <span className="faint">scan {state.meta.scanIntervalSec}s · {state.meta.llm}</span>
    </div>
  );
}
