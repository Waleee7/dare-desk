'use client';

// Today — leads with the big hero P&L number (Broker), then everything as
// hairline-ruled ledger rows (Ledger): positions with a live stop→TP rail, the
// desk-talk feed, what fired, what it's watching. Plain-English throughout.

import type { DashboardState, PositionView, SignalRow } from '../lib/types';
import { signedMoney, signedPct, money, plClass, contractLabel, sideLabel, gradeClass, timeAgo } from '../lib/format';

export default function TodayTab({ state, onTicker }: { state: DashboardState; onTicker: (t: string) => void }) {
  const d = state.day;
  const positions = state.positions ?? [];
  const events = (state.exitEvents ?? []).slice(0, 8);
  const fired = state.signals.filter((s) => s.fired && (s.grade === 'A+' || s.grade === 'A'));
  const watching = state.signals.filter((s) => s.grade === 'B');
  const pnl = d?.realizedPnlUsd ?? 0;

  return (
    <div>
      <div className="hero">
        <div className="label">Today’s result — modeled paper</div>
        <div className={`big ${plClass(pnl) || 'flat'}`}>{signedMoney(pnl)}</div>
        <div className="sub">
          <b>{positions.length}</b> {positions.length === 1 ? 'trade' : 'trades'} on
          {d ? <> · peaked at <b>{signedMoney(d.peakPnlUsd)}</b></> : null}
          {' '}· <b>{state.proveIt.paperTrades}</b> of {state.proveIt.needed} practice trades logged
        </div>
      </div>

      {d?.standDownReason && <div className="stand-down">⛔ Standing down today — {d.standDownReason}</div>}

      <div className="section-label">Open trades <span className="count">{positions.length}</span></div>
      {positions.length === 0 ? (
        <div className="empty">Nothing on. The desk only fires A+/A setups — flat is a position too.</div>
      ) : (
        <div className="ledger">{positions.map((p) => <PositionRow key={p.id} p={p} onTicker={onTicker} />)}</div>
      )}

      {events.length > 0 && (
        <>
          <div className="section-label">What the desk is saying</div>
          {events.map((ev, i) => (
            <div className="note" key={`${ev.positionId}-${ev.at}-${i}`}>
              <span className="when">{ev.etTime.slice(0, 5)} ET</span>{ev.message}
            </div>
          ))}
        </>
      )}

      <div className="section-label">New signals <span className="count">{fired.length}</span></div>
      {fired.length === 0 ? (
        <div className="empty">No new signals this scan — the gates are holding the bar at A.</div>
      ) : (
        <div className="ledger">{fired.map((s, i) => <SignalRowView key={`${s.ticker}-${i}`} s={s} onTicker={onTicker} />)}</div>
      )}

      {watching.length > 0 && (
        <>
          <div className="section-label">Keeping an eye on <span className="count">{watching.length}</span></div>
          <div className="ledger">
            {watching.map((s, i) => (
              <div className="lrow" key={`${s.ticker}-w-${i}`}>
                <div className="avatar muted" onClick={() => onTicker(s.ticker)} style={{ cursor: 'pointer' }}>{s.ticker}</div>
                <div className="lbody">
                  <div className="ltitle">{s.ticker} {sideLabel(s.direction).toLowerCase()} <span className={`grade ${gradeClass(s.grade)}`}>{s.grade} · {s.confidence}%</span></div>
                  <div className="lsub">{s.setup} — needs confirmation first</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="foot">Modeled paper trading · educational · not financial advice</div>
    </div>
  );
}

function PositionRow({ p, onTicker }: { p: PositionView; onTicker: (t: string) => void }) {
  const est = p.lastEstPremium ?? p.fillPremium;
  const stop = p.status === 'runner' ? p.fillPremium : p.stopPremium;
  const hi = Math.max(p.tp2Premium, p.tp1Premium, est, p.fillPremium);
  const lo = Math.min(stop > 0 ? stop : est * 0.6, est, p.fillPremium);
  const span = Math.max(0.01, hi - lo);
  const at = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const green = (p.plUsd ?? 0) >= 0;

  return (
    <div className="lrow" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
        <div className={`avatar ${green ? '' : 'red'}`} onClick={() => onTicker(p.ticker)} style={{ cursor: 'pointer' }}>{p.ticker}</div>
        <div className="lbody">
          <div className="ltitle">
            {p.ticker} {sideLabel(p.direction).toLowerCase()}
            <span className={`grade ${gradeClass(p.grade)}`}>{p.grade}</span>
          </div>
          <div className="lsub">{p.contracts}x {contractLabel(p.contract)} · {p.status === 'runner' ? 'runner on — stop at breakeven' : `in @ ${money(p.fillPremium)}`}</div>
        </div>
        <div className="lright">
          <div className={`big ${plClass(p.plUsd)}`}>{signedMoney(p.plUsd)}</div>
          <div className={`small ${plClass(p.plPct)}`}>{signedPct(p.plPct)}</div>
        </div>
      </div>
      <div style={{ width: '100%', paddingLeft: 56 }}>
        <div className="rail">
          <div className="fill" style={{ left: `${Math.min(at(p.fillPremium), at(est))}%`, width: `${Math.abs(at(est) - at(p.fillPremium))}%`, background: green ? 'var(--up)' : 'var(--down)' }} />
          {p.tp1Premium > 0 && <div className="notch" style={{ left: `${at(p.tp1Premium)}%` }} title="TP1" />}
          {p.tp2Premium > 0 && <div className="notch" style={{ left: `${at(p.tp2Premium)}%` }} title="TP2" />}
        </div>
        <div className="rail-labels">
          <span>stop {money(stop)}</span>
          <span>now {money(est)}</span>
          <span>TP {money(p.tp1Premium)} / {money(p.tp2Premium)}</span>
        </div>
      </div>
    </div>
  );
}

function SignalRowView({ s, onTicker }: { s: SignalRow; onTicker: (t: string) => void }) {
  return (
    <div className="lrow">
      <div className="avatar" onClick={() => onTicker(s.ticker)} style={{ cursor: 'pointer' }}>{s.ticker}</div>
      <div className="lbody">
        <div className="ltitle">{s.ticker} {sideLabel(s.direction).toLowerCase()} <span className={`grade ${gradeClass(s.grade)}`}>{s.grade} · {s.confidence}%</span></div>
        <div className="lsub">{s.setup} — {s.contract}, entry {s.entry ?? '—'}, stop {s.stop ?? '—'}</div>
      </div>
      <div className="lright small">⏰ {s.entryTimeEt.slice(0, 5)}<br />{timeAgo(s.time)}</div>
    </div>
  );
}
