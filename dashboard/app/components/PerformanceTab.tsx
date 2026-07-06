'use client';

// Performance — the honest scoreboard. Prove-it progress, expectancy in R,
// by-regime buckets, and the discipline panel (what the firewall is enforcing
// right now). Numbers are MODELED paper fills; the copy never forgets that.

import type { DashboardState } from '../lib/types';
import { signedMoney, signedR, plClass } from '../lib/format';

export default function PerformanceTab({ state }: { state: DashboardState }) {
  const e = state.expectancy;
  const d = state.day;
  const provePct = Math.min(100, (state.proveIt.paperTrades / Math.max(1, state.proveIt.needed)) * 100);
  const regimes = [
    { key: 'up' as const, label: 'up' },
    { key: 'down' as const, label: 'down' },
    { key: 'flat' as const, label: 'flat' },
  ];
  const maxAbsR = Math.max(0.1, ...regimes.map((r) => Math.abs(e.byRegime[r.key].expectancyR)));

  return (
    <div>
      <div className="section-label">Prove-it gate</div>
      <div className="card hero">
        <div className="row">
          <b>{state.proveIt.proven ? '✅ Passed' : '🔒 Building the sample'}</b>
          <span className="spacer" />
          <span className="num dim">{state.proveIt.paperTrades} / {state.proveIt.needed} paper trades</span>
        </div>
        <div className="prove-rail"><div className="fill" style={{ width: `${provePct}%` }} /></div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
          No performance claims until 100 validated paper trades, positive expectancy, and no losing regime bucket.
          All fills modeled — not live execution. Not financial advice.
        </div>
      </div>

      <div className="section-label">Expectancy (modeled)</div>
      <div className="tiles" style={{ marginBottom: 10 }}>
        <div className="tile">
          <div className="k">Expectancy</div>
          <div className={`v ${plClass(e.expectancyR)}`}>{e.trades ? signedR(e.expectancyR) : '—'}</div>
          <div className="sub">per trade, in R</div>
        </div>
        <div className="tile">
          <div className="k">Win rate</div>
          <div className="v">{e.trades ? `${Math.round(e.winRate * 100)}%` : '—'}</div>
          <div className="sub">{e.trades} closed</div>
        </div>
        <div className="tile">
          <div className="k">Profit factor</div>
          <div className="v">{e.trades ? e.profitFactor : '—'}</div>
          <div className="sub">gross win / gross loss</div>
        </div>
        <div className="tile">
          <div className="k">Avg hold</div>
          <div className="v">{e.trades ? `${Math.round(e.avgHoldMinutes)}m` : '—'}</div>
          <div className="sub">win {e.trades ? signedR(e.avgWin) : '—'} · loss {e.trades ? signedR(e.avgLoss) : '—'}</div>
        </div>
      </div>

      {e.trades > 0 && (
        <>
          <div className="section-label">By regime</div>
          <div className="card">
            {regimes.map((r) => {
              const b = e.byRegime[r.key];
              const w = (Math.abs(b.expectancyR) / maxAbsR) * 100;
              return (
                <div className="hbar" key={r.key}>
                  <span className="lbl">{r.label}</span>
                  <div className="track">
                    <div className="bar" style={{ width: `${w}%`, background: b.expectancyR >= 0 ? 'var(--up)' : 'var(--down)' }} />
                  </div>
                  <span className={`val ${plClass(b.expectancyR)}`}>{b.trades ? signedR(b.expectancyR) : '—'}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {d && (
        <>
          <div className="section-label">Discipline panel · {d.date}</div>
          <div className="tiles">
            <div className="tile">
              <div className="k">Day P/L</div>
              <div className={`v ${plClass(d.realizedPnlUsd)}`}>{signedMoney(d.realizedPnlUsd)}</div>
              <div className="sub">peak {signedMoney(d.peakPnlUsd)} · profit-lock arms at +2%</div>
            </div>
            <div className="tile">
              <div className="k">Open risk</div>
              <div className="v">{signedMoney(d.openRiskUsd).replace('+', '')}</div>
              <div className="sub">{d.openPositionsCount}/5 positions · cap 3% at-stop</div>
            </div>
            <div className="tile">
              <div className="k">Sizing</div>
              <div className="v">{d.sizeMultiplier === 1 ? '1.0x' : `${d.sizeMultiplier}x`}</div>
              <div className="sub">{d.sizeMultiplier < 1 ? 'red-streak half size' : 'normal risk budget'}</div>
            </div>
            <div className="tile">
              <div className="k">Status</div>
              <div className="v" style={{ fontSize: 15 }}>
                {d.standDownReason ? '⛔ stand-down'
                  : d.cooldownUntil && d.cooldownUntil > Date.now() ? '⏸ cooldown'
                  : '🟢 trading'}
              </div>
              <div className="sub">{d.standDownReason ?? `${d.tradesToday} trades today`}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
