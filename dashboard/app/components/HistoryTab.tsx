'use client';

// History — closed paper trades (the evidence) and the decision journal
// (everything the desk evaluated, fired or filtered, with the reason why).

import type { DashboardState } from '../lib/types';
import { signedMoney, signedR, plClass, gradeClass, timeAgo } from '../lib/format';

export default function HistoryTab({ state }: { state: DashboardState }) {
  const closed = [...(state.closedTrades ?? [])].reverse();
  const journal = [...state.journal].reverse().slice(0, 40);

  return (
    <div>
      <div className="section-label">Closed paper trades · {closed.length}</div>
      {closed.length === 0 ? (
        <div className="empty">
          No closed trades yet. The exit monitor closes every position it opens —
          this fills up as fires resolve.
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table className="desk">
            <thead>
              <tr>
                <th>Ticker</th><th>Setup</th><th>In → Out (ET)</th>
                <th style={{ textAlign: 'right' }}>P/L</th>
                <th style={{ textAlign: 'right' }}>R</th>
                <th style={{ textAlign: 'right' }}>Hold</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((t, i) => (
                <tr key={i}>
                  <td className="num"><b>{t.ticker}</b></td>
                  <td className="dim">{t.setup}</td>
                  <td className="num dim">{t.entryTimeEt.slice(0, 5)} → {t.exitTimeEt.slice(0, 5)}</td>
                  <td className={`num ${plClass(t.pnlUsd)}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                    {signedMoney(t.pnlUsd)}
                  </td>
                  <td className={`num ${plClass(t.rMultiple)}`} style={{ textAlign: 'right' }}>{signedR(t.rMultiple)}</td>
                  <td className="num dim" style={{ textAlign: 'right' }}>{Math.round(t.holdMinutes)}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-label">Decision journal</div>
      {journal.length === 0 ? (
        <div className="empty">No evaluations yet.</div>
      ) : (
        <div className="card">
          {journal.map((j, i) => (
            <div className="feed-item" key={i}>
              <span className="when">{timeAgo(j.at)}</span>
              <span>
                <b className="num">{j.ticker}</b> <span className="dim">{j.setup}</span>{' '}
                <span className={`grade-pill ${gradeClass(j.grade)}`}>{j.grade}</span>{' '}
                <span className="dim">
                  {j.outcome === 'alerted' ? '→ fired' : j.outcome === 'watch' ? '→ watching' : '→ filtered'}
                </span>
                {j.blocks.length > 0 && (
                  <span className="faint"> · {j.blocks[0]!.split(' (')[0]}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
