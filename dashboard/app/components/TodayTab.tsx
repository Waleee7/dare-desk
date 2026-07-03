'use client';

// Today — the clean screen. What's ON (live positions with exit status), what
// the desk is saying (exit-monitor feed), what fired today, and what it's
// watching. One glance = the whole day.

import type { DashboardState, PositionView, SignalRow } from '../lib/types';
import { signedMoney, signedPct, money, plClass, contractLabel, sideLabel, gradeClass, timeAgo } from '../lib/format';

export default function TodayTab({ state, onTicker }: { state: DashboardState; onTicker: (t: string) => void }) {
  const positions = state.positions ?? [];
  const events = (state.exitEvents ?? []).slice(0, 12);
  const fired = state.signals.filter((s) => s.fired && (s.grade === 'A+' || s.grade === 'A'));
  const watching = state.signals.filter((s) => s.grade === 'B');

  return (
    <div>
      {state.day?.standDownReason && (
        <div className="stand-down">⛔ Standing down today — {state.day.standDownReason}</div>
      )}

      <div className="section-label">Positions on · {positions.length}</div>
      {positions.length === 0 ? (
        <div className="empty">Nothing on. The desk fires only A+/A setups — flat is a position too.</div>
      ) : (
        positions.map((p) => <PositionCard key={p.id} p={p} onTicker={onTicker} />)
      )}

      {events.length > 0 && (
        <>
          <div className="section-label">Desk talk</div>
          <div className="card">
            {events.map((ev, i) => (
              <div className="feed-item" key={`${ev.positionId}-${ev.at}-${i}`}>
                <span className="when">{ev.etTime.slice(0, 5)}</span>
                <span>{ev.message}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">Fired this scan · {fired.length}</div>
      {fired.length === 0 ? (
        <div className="empty">No fires on the last scan — the gates are holding the bar at A.</div>
      ) : (
        fired.map((s, i) => <SignalCard key={`${s.ticker}-${i}`} s={s} onTicker={onTicker} />)
      )}

      {watching.length > 0 && (
        <>
          <div className="section-label">Watching · {watching.length}</div>
          {watching.map((s, i) => (
            <div className="card" key={`${s.ticker}-w-${i}`} style={{ opacity: 0.75 }}>
              <div className="row">
                <b className="num" style={{ cursor: 'pointer' }} onClick={() => onTicker(s.ticker)}>{s.ticker}</b>
                <span className="dim">{sideLabel(s.direction)} · {s.setup}</span>
                <span className="spacer" />
                <span className={`grade-pill ${gradeClass(s.grade)}`}>{s.grade} · {s.confidence}%</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** One open paper position: live P/L, and where it sits between stop and TP2. */
function PositionCard({ p, onTicker }: { p: PositionView; onTicker: (t: string) => void }) {
  const est = p.lastEstPremium ?? p.fillPremium;
  const stop = p.status === 'runner' ? p.fillPremium : p.stopPremium;
  const hi = Math.max(p.tp2Premium, p.tp1Premium, est);
  const lo = Math.min(stop > 0 ? stop : est * 0.6, est);
  const span = Math.max(0.01, hi - lo);
  const pctAt = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const green = (p.plUsd ?? 0) >= 0;

  return (
    <div className="card hero">
      <div className="row">
        <b className="num" style={{ fontSize: 17, cursor: 'pointer' }} onClick={() => onTicker(p.ticker)}>{p.ticker}</b>
        <span className="dim">{sideLabel(p.direction)} · {p.contracts}x {contractLabel(p.contract)}</span>
        <span className="spacer" />
        <span className={`grade-pill ${gradeClass(p.grade)}`}>{p.grade}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className={`num ${plClass(p.plUsd)}`} style={{ fontSize: 24, fontWeight: 800 }}>
          {signedMoney(p.plUsd)}
        </span>
        <span className={`num ${plClass(p.plPct)}`} style={{ fontSize: 14 }}>{signedPct(p.plPct)}</span>
        <span className="spacer" />
        <span className="pill">{p.status === 'runner' ? '🏃 runner · stop @ breakeven' : `in @ ${money(p.fillPremium)}`}</span>
      </div>
      <div className="rail">
        <div
          className="fill"
          style={{
            left: `${Math.min(pctAt(p.fillPremium), pctAt(est))}%`,
            width: `${Math.abs(pctAt(est) - pctAt(p.fillPremium))}%`,
            background: green ? 'var(--green)' : 'var(--red)',
          }}
        />
        {p.tp1Premium > 0 && <div className="notch gold" style={{ left: `${pctAt(p.tp1Premium)}%` }} title="TP1" />}
        {p.tp2Premium > 0 && <div className="notch gold" style={{ left: `${pctAt(p.tp2Premium)}%` }} title="TP2" />}
      </div>
      <div className="rail-labels">
        <span>stop {money(stop)}</span>
        <span>mark {money(est)}</span>
        <span>TP1 {money(p.tp1Premium)} · TP2 {money(p.tp2Premium)}</span>
      </div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
        {p.setup} · in {p.entryTimeEt.slice(0, 5)} ET{p.zeroDte ? ' · 0DTE flat by 15:55' : ''}
        {p.timeStopMin > 0 ? ` · time stop ${p.timeStopMin}m` : ''}
      </div>
    </div>
  );
}

/** A fired signal — the entry ticket, card form. */
function SignalCard({ s, onTicker }: { s: SignalRow; onTicker: (t: string) => void }) {
  return (
    <div className="card">
      <div className="row">
        <b className="num" style={{ fontSize: 16, cursor: 'pointer' }} onClick={() => onTicker(s.ticker)}>{s.ticker}</b>
        <span className="dim">{sideLabel(s.direction)} · {s.setup}</span>
        <span className="spacer" />
        <span className={`grade-pill ${gradeClass(s.grade)}`}>{s.grade} · {s.confidence}%</span>
      </div>
      <div className="row num dim" style={{ marginTop: 6, fontSize: 13 }}>
        <span>{s.contract}</span>
        <span className="spacer" />
        <span>entry {s.entry ?? '—'} · stop {s.stop ?? '—'} · tgt {s.targets.join(' / ') || '—'}</span>
      </div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
        ⏰ {s.entryTimeEt.slice(0, 5)} ET · cost {s.costPaidUsd != null ? money(s.costPaidUsd, 0) : '—'} · R:R {s.rewardRisk ?? '—'} · {timeAgo(s.time)}
      </div>
    </div>
  );
}
