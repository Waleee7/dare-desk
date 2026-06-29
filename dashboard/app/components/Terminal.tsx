'use client';

import { useState } from 'react';

interface SignalRow {
  ticker: string; setup: string; timeframe: string; direction: string; contract: string;
  entry: number | null; stop: number | null; targets: number[]; grade: string; total: number;
  confidence: number; rewardRisk: number | null; status: string; fired: boolean; blocks: string[];
}
interface JournalEntry {
  ticker: string; setup: string; grade: string; total: number; outcome: string;
  mistakeTags: string[]; ruleIdea?: string; blocks?: string[];
}
interface Meta {
  llm: string; newsProvider: string; scanIntervalSec: number; marketHours: string;
  accountSizeUsd: number; maxRiskPerTradePct: number; maxDailyLossPct: number; liveTrading: boolean;
}
interface State {
  brand: string; updatedAt: string; provider: string; scanned: number;
  signals: SignalRow[]; journal: JournalEntry[];
  summary: { total: number; alerted: number; watched: number; skipped: number; topBlocks: string[] };
  headlines: string[]; meta: Meta;
}

const TABS = ['Live', 'History', 'Performance', 'News', 'Settings'] as const;
type Tab = (typeof TABS)[number];

const gradeClass = (g: string) => (g === 'SIGNAL' ? 'g-fire' : g === 'WATCH' ? 'g-watch' : 'g-rej');
const gradeLabel = (g: string) => (g === 'SIGNAL' ? '🚨 SIGNAL' : g === 'WATCH' ? '👀 WATCH' : 'PASS');
const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(2));

export default function Terminal({ state }: { state: State | null }) {
  const [tab, setTab] = useState<Tab>('Live');
  const brand = state?.brand ?? 'DARE Desk';
  const fired = state?.signals.filter((r) => r.fired).length ?? 0;

  return (
    <>
      <header className="topbar">
        <div className="brand">{brand.replace(/\s/g, '')}<span className="dot">.</span><span className="sub">signal desk</span></div>
        <div className="pills">
          {state && <>
            <span className="pill">feed <b>{state.provider}</b></span>
            <span className="pill">news <b>{state.meta.newsProvider}</b></span>
            <span className="pill">scoring <b>{state.meta.llm}</b></span>
            <span className={`pill ${state.meta.liveTrading ? 'live' : 'paper'}`}>{state.meta.liveTrading ? 'LIVE' : 'PAPER'}</span>
          </>}
        </div>
        <span className="upd">{state ? new Date(state.updatedAt).toLocaleString() : 'no data'}</span>
      </header>

      <div className="ticker">
        <b>◆ NEWS</b>
        {(state?.headlines?.length ? state.headlines : ['Run a scan to populate the feed']).map((h, i) => (
          <span key={i}>{i > 0 && <span className="sep">•</span>}{h}</span>
        ))}
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Live' && state ? <span className="cnt">{fired}</span> : null}
            {t === 'History' && state ? <span className="cnt">{state.journal.length}</span> : null}
          </button>
        ))}
      </nav>

      <main className="content">
        {!state ? (
          <div className="empty">No scan data yet. Run <code>npm run scan</code> (or <code>npm run go</code>) in the bot, then refresh.</div>
        ) : tab === 'Live' ? (
          <Live state={state} fired={fired} />
        ) : tab === 'History' ? (
          <History state={state} />
        ) : tab === 'Performance' ? (
          <Performance state={state} />
        ) : tab === 'News' ? (
          <News state={state} />
        ) : (
          <Settings state={state} />
        )}
      </main>
    </>
  );
}

function Live({ state, fired }: { state: State; fired: number }) {
  return (
    <>
      <div className="kpis">
        <div className="kpi acc"><div className="n">{state.scanned}</div><div className="l">Scanned</div></div>
        <div className="kpi fire"><div className="n">{fired}</div><div className="l">Signals</div></div>
        <div className="kpi watch"><div className="n">{state.summary.watched}</div><div className="l">Watch</div></div>
        <div className="kpi dim"><div className="n">{state.summary.skipped}</div><div className="l">Filtered</div></div>
      </div>
      <h3 className="sec">Today&apos;s Signals</h3>
      <table>
        <thead>
          <tr>
            <th>Ticker</th><th>Setup</th><th>Contract</th>
            <th className="num">Entry</th><th className="num">Stop</th><th className="num">R:R</th>
            <th className="num">Conf</th><th>Grade</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {state.signals.map((r, i) => (
            <tr key={i}>
              <td><span className={`tk dir-${r.direction}`}>{r.ticker}</span><span className="tf">{r.timeframe}</span></td>
              <td>{r.setup}</td>
              <td className="num">{r.contract}</td>
              <td className="num">{fmt(r.entry)}</td>
              <td className="num">{fmt(r.stop)}</td>
              <td className="num">{r.rewardRisk ? r.rewardRisk.toFixed(2) : '—'}</td>
              <td className="num">{r.confidence}%</td>
              <td><span className={`badge ${gradeClass(r.grade)}`}>{gradeLabel(r.grade)}</span></td>
              <td>{r.fired ? '🔔 fired' : '— filtered'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function History({ state }: { state: State }) {
  return (
    <>
      <h3 className="sec">Journal &amp; History</h3>
      <div className="panel">
        {state.journal.slice().reverse().map((e, i) => (
          <div className="jrow" key={i}>
            <span className={`badge ${gradeClass(e.grade)}`}>{gradeLabel(e.grade)}</span>
            <span className="tk">{e.ticker}</span>
            <span style={{ color: 'var(--muted)' }}>{e.setup} · {e.total}/100 · {e.outcome}</span>
            {e.mistakeTags.map((t, j) => <span className="tag" key={j}>{t}</span>)}
            {e.blocks?.length ? <span className="blk">{e.blocks[0]}</span> : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Performance({ state }: { state: State }) {
  const grades = ['SIGNAL', 'WATCH', 'REJECT'];
  const counts = grades.map((g) => state.journal.filter((e) => e.grade === g).length);
  const max = Math.max(1, ...counts);
  const colors: Record<string, string> = { SIGNAL: 'var(--fire)', WATCH: 'var(--watch)', REJECT: 'var(--rej)' };
  return (
    <>
      <div className="kpis">
        <div className="kpi fire"><div className="n">{state.summary.alerted}</div><div className="l">Alerted</div></div>
        <div className="kpi watch"><div className="n">{state.summary.watched}</div><div className="l">Watch</div></div>
        <div className="kpi dim"><div className="n">{state.summary.skipped}</div><div className="l">Skipped</div></div>
        <div className="kpi acc"><div className="n">{state.journal.length}</div><div className="l">Evaluated</div></div>
      </div>
      <h3 className="sec">Grade Distribution</h3>
      <div className="panel" style={{ padding: 16 }}>
        <div className="bars">
          {grades.map((g, i) => (
            <div className="bar" key={g}>
              <span>{gradeLabel(g)}</span>
              <span className="track"><span className="fill" style={{ width: `${(counts[i]! / max) * 100}%`, background: colors[g] }} /></span>
              <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{counts[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <h3 className="sec">Top Filter Reasons</h3>
      <div className="panel" style={{ padding: '6px 0' }}>
        {state.summary.topBlocks.length
          ? state.summary.topBlocks.map((b, i) => <div className="jrow" key={i}><span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{b}</span></div>)
          : <div className="jrow" style={{ color: 'var(--dim)' }}>No filters triggered.</div>}
      </div>
      <p className="note">P/L, win-rate &amp; drawdown activate once paper fills close (trade-outcome tracking). No profitability claims before ≥100 validated paper trades.</p>
    </>
  );
}

function News({ state }: { state: State }) {
  return (
    <>
      <h3 className="sec">Verified News Feed</h3>
      <div className="panel">
        {state.headlines.length ? state.headlines.map((h, i) => {
          const idx = h.lastIndexOf(' — ');
          const headline = idx > -1 ? h.slice(0, idx) : h;
          const src = idx > -1 ? h.slice(idx + 3) : 'feed';
          return <div className="newsitem" key={i}><span className="src">{src}</span><span>{headline}</span></div>;
        }) : <div className="newsitem" style={{ color: 'var(--dim)' }}>No news feed configured — add ALPACA or ALPHAVANTAGE keys.</div>}
      </div>
      <p className="note">Every headline carries a real, attributed source. Feed: {state.meta.newsProvider}.</p>
    </>
  );
}

function Settings({ state }: { state: State }) {
  const m = state.meta;
  const rows: [string, string][] = [
    ['Data feed', state.provider],
    ['News feed', m.newsProvider],
    ['Scoring', m.llm],
    ['Scan interval', `${m.scanIntervalSec}s`],
    ['Market hours', m.marketHours],
    ['Account size', `$${m.accountSizeUsd.toLocaleString()}`],
    ['Max risk / trade', `${m.maxRiskPerTradePct}%`],
    ['Max daily loss', `${m.maxDailyLossPct}%`],
    ['Live trading', m.liveTrading ? 'ENABLED' : 'DISABLED (paper-first)'],
  ];
  return (
    <>
      <h3 className="sec">Configuration</h3>
      <div className="kv">
        {rows.flatMap(([k, v]) => [
          <div className="k" key={k}>{k}</div>,
          <div className="v" key={`${k}::v`}>{v}</div>,
        ])}
      </div>
      <p className="note">Keys live in the bot&apos;s .env. Add ANTHROPIC / ALPACA / ALPHAVANTAGE / DISCORD to go fully live.</p>
    </>
  );
}
