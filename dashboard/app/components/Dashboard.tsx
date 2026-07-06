'use client';

// The shell — masthead (serif brand + LIVE/MOCK badge + light/dark toggle),
// a slim status line, the tab bar, and the 15s polling loop. Each tab owns its
// own header (Today leads with the big hero P&L number).

import { useCallback, useEffect, useState } from 'react';
import type { DashboardState } from '../lib/types';
import { signedMoney, plClass } from '../lib/format';
import TodayTab from './TodayTab';
import ChartsTab from './ChartsTab';
import HistoryTab from './HistoryTab';
import PerformanceTab from './PerformanceTab';
import NewsTab from './NewsTab';

const TABS = [
  { id: 'today', label: 'Today', ico: '◉' },
  { id: 'charts', label: 'Charts', ico: '∿' },
  { id: 'history', label: 'History', ico: '☰' },
  { id: 'performance', label: 'Results', ico: '▦' },
  { id: 'news', label: 'News', ico: '≣' },
] as const;
type TabId = (typeof TABS)[number]['id'];
type Mode = 'light' | 'dark';

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<TabId>('today');
  const [chartTicker, setChartTicker] = useState('SPY');
  // Server and first client render both start 'light' (matches SSR → no hydration
  // mismatch). The pre-paint script already set the real mode on <html>, so the
  // visuals are correct immediately; we read that saved value in on mount.
  const [mode, setMode] = useState<Mode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode((document.documentElement.dataset.mode as Mode) || 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.mode = mode;
    try { localStorage.setItem('desk-mode', mode); } catch { /* private mode */ }
  }, [mode, mounted]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.status === 404) { setMissing(true); return; }
      if (!res.ok) return;
      setState((await res.json()) as DashboardState);
      setMissing(false);
    } catch { /* retry next tick */ }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const openChart = useCallback((ticker: string) => {
    setChartTicker(ticker.toUpperCase());
    setTab('charts');
  }, []);

  const toggle = <button className="mode-toggle" onClick={() => setMode(mode === 'light' ? 'dark' : 'light')} title={mode === 'light' ? 'Dark mode' : 'Light mode'} aria-label="Toggle light/dark">{mode === 'light' ? '☾' : '☀'}</button>;

  if (missing) {
    return (
      <div className="shell">
        <header className="masthead"><Brand /><span className="spacer" />{toggle}</header>
        <div className="empty" style={{ marginTop: 40 }}>
          No scan data yet.<br />
          <span className="faint">Start the bot: <code>npm run go</code> (or <code>npm run scan</code> for one pass).</span>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="masthead">
        <Brand />
        <span className="spacer" />
        {state && <ModeBadge state={state} />}
        {toggle}
      </header>
      {state && <StatusLine state={state} />}
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="ico" aria-hidden>{t.ico}</span>{t.label}
          </button>
        ))}
      </nav>
      {!state ? (
        <div className="empty" style={{ marginTop: 24 }}>Loading the desk…</div>
      ) : tab === 'today' ? <TodayTab state={state} onTicker={openChart} />
        : tab === 'charts' ? <ChartsTab state={state} ticker={chartTicker} onTicker={setChartTicker} mode={mode} />
        : tab === 'history' ? <HistoryTab state={state} />
        : tab === 'performance' ? <PerformanceTab state={state} />
        : <NewsTab state={state} />}
    </div>
  );
}

const Brand = () => <div className="brand">Dare <span className="gold">Desk</span></div>;

function ModeBadge({ state }: { state: DashboardState }) {
  const live = !state.provider.includes('mock');
  const ageMin = (Date.now() - Date.parse(state.updatedAt)) / 60_000;
  if (ageMin > 6) return <span className="badge stale"><span className="dot" />Idle · {Math.round(ageMin)}m</span>;
  return live
    ? <span className="badge live"><span className="dot" />Live</span>
    : <span className="badge mock"><span className="dot" />Practice</span>;
}

function StatusLine({ state }: { state: DashboardState }) {
  const d = state.day;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: 'var(--ink-dim)', paddingTop: 4 }}>
      {d && <span>Day <b className={`num ${plClass(d.realizedPnlUsd)}`}>{signedMoney(d.realizedPnlUsd)}</b></span>}
      {d && <span>On <b className="num">{d.openPositionsCount}</b></span>}
      {state.dayType && <span>Tape <b>{state.dayType === 'trend-up' ? 'trend ↑' : state.dayType === 'trend-down' ? 'trend ↓' : state.dayType}</b></span>}
      <span>Prove-it <b className="num">{state.proveIt.paperTrades}/{state.proveIt.needed}</b></span>
      {d?.standDownReason && <span className="down">⛔ stand-down</span>}
      {d && d.sizeMultiplier < 1 && <span className="down">½ size</span>}
    </div>
  );
}
