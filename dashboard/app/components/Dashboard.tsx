'use client';

// The shell — masthead (serif brand + LIVE/DEMO badge + settings + light/dark),
// a slim status line, the tab bar, and the polling loop. Each tab owns its own
// header (Today leads with the big hero P&L number).
//
// Demo mode (?demo=1, DARE_DESK_DEMO=1, or no data/state.json) serves the
// deterministic synthetic seed. In demo the shell advances a scripted `tick`
// every poll so new ARMED / signal alerts appear; `?tick=N` pins one frame
// (screenshots) and `?poll=ms` speeds the loop up (recordings).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardState } from '../lib/types';
import { signedMoney, plClass } from '../lib/format';
import { detectNewAlerts, hapticFor } from '../lib/alerts';
import { haptic, readHapticsPref, writeHapticsPref } from '../lib/haptics';
import TodayTab from './TodayTab';
import ChartsTab from './ChartsTab';
import HistoryTab from './HistoryTab';
import PerformanceTab from './PerformanceTab';
import NewsTab from './NewsTab';
import SettingsSheet from './SettingsSheet';

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const TABS = [
  { id: 'today', label: 'Today', ico: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z') },
  { id: 'charts', label: 'Charts', ico: svg('M3 17l5-6 4 3 8-9M3 21h18') },
  { id: 'history', label: 'History', ico: svg('M4 6h16M4 12h16M4 18h10') },
  { id: 'performance', label: 'Results', ico: svg('M5 20V11M12 20V4M19 20v-6') },
  { id: 'news', label: 'News', ico: svg('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 4h8M8 12h8M8 16h5') },
] as const;
type TabId = (typeof TABS)[number]['id'];
type Mode = 'light' | 'dark';

const POLL_MS = 15_000;
const DEMO_POLL_MS = 6_000;
const FRESH_MS = 7_000;

interface UrlCfg { demo: boolean; pinned: number | null; pollMs: number | null }
const readUrlCfg = (): UrlCfg => {
  const q = new URLSearchParams(window.location.search);
  const tick = Number.parseInt(q.get('tick') ?? '', 10);
  const poll = Number.parseInt(q.get('poll') ?? '', 10);
  return {
    demo: q.get('demo') === '1',
    pinned: Number.isFinite(tick) && tick >= 0 ? tick : null,
    pollMs: Number.isFinite(poll) ? Math.min(60_000, Math.max(1_000, poll)) : null,
  };
};

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabId>('today');
  const [chartTicker, setChartTicker] = useState('SPY');
  // Server and first client render both start 'light' (matches SSR → no hydration
  // mismatch). The pre-paint script already set the real mode on <html>, so the
  // visuals are correct immediately; we read that saved value in on mount.
  const [mode, setMode] = useState<Mode>('light');
  const [mounted, setMounted] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const prevRef = useRef<DashboardState | null>(null);
  const rawRef = useRef('');
  const cfgRef = useRef<UrlCfg>({ demo: false, pinned: null, pollMs: null });
  const tickRef = useRef(0);
  const hapticsRef = useRef(true);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMode((document.documentElement.dataset.mode as Mode) || 'light');
    const on = readHapticsPref();
    setHapticsOn(on);
    hapticsRef.current = on;
    cfgRef.current = readUrlCfg();
    tickRef.current = cfgRef.current.pinned ?? 0;
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.mode = mode;
    try { localStorage.setItem('desk-mode', mode); } catch { /* private mode */ }
  }, [mode, mounted]);

  const buzz = useCallback((kind: Parameters<typeof haptic>[0]) => {
    haptic(kind, { enabled: hapticsRef.current });
  }, []);

  const load = useCallback(async () => {
    try {
      const cfg = cfgRef.current;
      const params = new URLSearchParams();
      if (cfg.demo) params.set('demo', '1');
      params.set('tick', String(tickRef.current));
      const res = await fetch(`/api/state?${params}`, { cache: 'no-store' });
      if (!res.ok) { setError(true); return; }
      const raw = await res.text();
      setError(false);
      const next = JSON.parse(raw) as DashboardState;
      // Demo: advance the scripted scenario unless a frame is pinned.
      if (next.demo && cfg.pinned == null) tickRef.current += 1;
      if (raw === rawRef.current) return; // identical payload — skip the re-render (and chart rebuild)
      rawRef.current = raw;

      const newAlerts = detectNewAlerts(prevRef.current, next);
      const kind = hapticFor(newAlerts);
      if (kind) buzz(kind);
      const keys = [...newAlerts.armed, ...newAlerts.signals];
      if (keys.length) {
        setFresh(new Set(keys));
        if (freshTimer.current) clearTimeout(freshTimer.current);
        freshTimer.current = setTimeout(() => setFresh(new Set()), FRESH_MS);
      }
      prevRef.current = next;
      setState(next);
    } catch { /* retry next tick */ }
  }, [buzz]);

  // Self-scheduling poll: the cadence adapts once the first payload says "demo".
  useEffect(() => {
    if (!mounted) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      await load();
      if (stop) return;
      const every = cfgRef.current.pollMs ?? (prevRef.current?.demo ? DEMO_POLL_MS : POLL_MS);
      timer = setTimeout(() => void run(), every);
    };
    void run();
    return () => { stop = true; clearTimeout(timer); if (freshTimer.current) clearTimeout(freshTimer.current); };
  }, [load, mounted]);

  const openChart = useCallback((ticker: string) => {
    setChartTicker(ticker.toUpperCase());
    setTab('charts');
    buzz('tap');
  }, [buzz]);

  const pickTab = (id: TabId) => { if (id !== tab) buzz('tap'); setTab(id); };
  const flipMode = () => { setMode(mode === 'light' ? 'dark' : 'light'); buzz('toggle'); };
  const setHaptics = (on: boolean) => {
    setHapticsOn(on);
    hapticsRef.current = on;
    writeHapticsPref(on);
    if (on) haptic('toggle'); // confirmation buzz — only when turning ON
  };

  const toggle = (
    <button className="icon-btn" onClick={flipMode} title={mode === 'light' ? 'Dark mode' : 'Light mode'} aria-label="Toggle light/dark">
      {mode === 'light' ? '☾' : '☀'}
    </button>
  );
  const gear = (
    <button className="icon-btn" onClick={() => { setSettingsOpen(true); buzz('tap'); }} title="Settings" aria-label="Settings" aria-haspopup="dialog">⚙</button>
  );

  return (
    <div className="shell">
      {state?.demo && (
        <div className="demo-banner" role="note">
          <b>DEMO DATA</b>
          <span className="long">Synthetic and deterministic — no keys, no market feed, no real fills.</span>
          <span className="short">Synthetic · no keys · no real fills</span>
        </div>
      )}
      <header className="masthead">
        <Brand />
        <span className="spacer" />
        {state && <ModeBadge state={state} />}
        {gear}
        {toggle}
      </header>
      {state && <StatusLine state={state} />}
      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => pickTab(t.id)}>
            <span className="ico">{t.ico}</span>{t.label}
          </button>
        ))}
      </nav>
      {!state ? (
        <div className="empty" style={{ marginTop: 24 }}>
          {error ? <>Couldn’t read the desk state.<br /><span className="faint">Retrying every few seconds…</span></> : 'Loading the desk…'}
        </div>
      ) : tab === 'today' ? <TodayTab state={state} onTicker={openChart} fresh={fresh} />
        : tab === 'charts' ? <ChartsTab state={state} ticker={chartTicker} onTicker={setChartTicker} mode={mode} />
        : tab === 'history' ? <HistoryTab state={state} />
        : tab === 'performance' ? <PerformanceTab state={state} />
        : <NewsTab state={state} />}
      {settingsOpen && (
        <SettingsSheet
          state={state}
          hapticsOn={hapticsOn}
          onHaptics={setHaptics}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

const Brand = () => <div className="brand">Dare <span className="gold">Desk</span></div>;

function ModeBadge({ state }: { state: DashboardState }) {
  if (state.demo) return <span className="badge demo"><span className="dot" />Demo</span>;
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
    <div className="status-line">
      {d && <span>Day <b className={`num ${plClass(d.realizedPnlUsd)}`}>{signedMoney(d.realizedPnlUsd)}</b></span>}
      {d && <span>On <b className="num">{d.openPositionsCount}</b></span>}
      {state.dayType && <span>Tape <b>{state.dayType === 'trend-up' ? 'trend ↑' : state.dayType === 'trend-down' ? 'trend ↓' : state.dayType}</b></span>}
      <span>Prove-it <b className="num">{state.proveIt.paperTrades}/{state.proveIt.needed}</b></span>
      {d?.standDownReason && <span className="down">⛔ stand-down</span>}
      {d && d.sizeMultiplier < 1 && <span className="down">½ size</span>}
    </div>
  );
}
