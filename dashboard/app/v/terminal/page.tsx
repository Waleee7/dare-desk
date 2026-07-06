import Switcher from '../Switcher';
import { sample as s } from '../sample';
import css from './terminal.module.css';

export const metadata = { title: 'Preview · Command Rail' };

export default function TerminalPreview() {
  return (
    <div className={css.page}>
      <Switcher active="terminal" />

      <aside className={css.rail}>
        <div className={css.brand}>◆ DARE DESK</div>
        <a className={css.on} href="#">Today</a>
        <a href="#">Charts</a>
        <a href="#">History</a>
        <a href="#">Performance</a>
        <a href="#">News</a>
        <div className={css.railFoot}>
          LIVE · {s.tape}<br />
          prove-it {s.proveIt.done}/{s.proveIt.needed}<br />
          scan 120s
        </div>
      </aside>

      <div className={css.main}>
        <div className={css.strip}>
          <div className={css.stat}>
            <div className={css.k}>Day P/L</div>
            <div className={`${css.v} ${css.pos}`}>+${s.dayPnl.toFixed(2)}</div>
          </div>
          <div className={css.stat}>
            <div className={css.k}>Peak</div>
            <div className={css.v}>+${s.peak.toFixed(0)}</div>
          </div>
          <div className={css.stat}>
            <div className={css.k}>Positions</div>
            <div className={`${css.v} ${css.gold}`}>{s.positionsOn}</div>
          </div>
          <div className={css.stat}>
            <div className={css.k}>Risk at stop</div>
            <div className={css.v}>${s.openRisk}</div>
          </div>
          <div className={css.stat}>
            <div className={css.k}>Tape</div>
            <div className={css.v}>{s.tape}</div>
          </div>
        </div>

        <div className={css.grid}>
          <section className={css.panel}>
            <div className={css.panelHead}>Positions on <span className={css.n}>{s.positions.length}</span></div>
            {s.positions.map((p) => {
              const span = p.tp2 - p.stop;
              const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - p.stop) / span) * 100))}%`;
              return (
                <div className={css.posRow} key={p.ticker}>
                  <div className={css.posTop}>
                    <span className={css.tick}>{p.ticker}</span>
                    <span className={css.side}>{p.side} · {p.qty}</span>
                    <span className={css.gradeTag}>{p.grade}</span>
                    <span className={`${css.plRight} ${p.plUsd >= 0 ? css.pos : css.neg}`}>
                      {p.plUsd >= 0 ? '+' : '−'}${Math.abs(p.plUsd).toFixed(2)} · {p.plPct >= 0 ? '+' : ''}{p.plPct}%
                    </span>
                  </div>
                  <div className={css.bar}>
                    <div
                      className={css.fill}
                      style={{
                        left: pct(Math.min(p.entry, p.mark)), right: `calc(100% - ${pct(Math.max(p.entry, p.mark))})`,
                        background: p.plUsd >= 0 ? '#52d99a' : '#e07b6f',
                      }}
                    />
                    <div className={css.tp} style={{ left: pct(p.tp1) }} />
                    <div className={css.tp} style={{ left: pct(p.tp2) }} />
                  </div>
                  <div className={css.posMeta}>
                    stop {p.stop.toFixed(2)} · mark {p.mark.toFixed(2)} · TP {p.tp1.toFixed(2)}/{p.tp2.toFixed(2)} — {p.status}
                  </div>
                </div>
              );
            })}
            <div className={css.panelHead} style={{ borderTop: '1px solid #103527' }}>
              Fired today <span className={css.n}>{s.fired.length}</span>
            </div>
            {s.fired.map((f) => (
              <div className={css.posRow} key={f.ticker}>
                <div className={css.posTop}>
                  <span className={css.tick}>{f.ticker}</span>
                  <span className={css.side}>{f.side} · {f.setup}</span>
                  <span className={css.gradeTag}>{f.grade} {f.conf}%</span>
                </div>
                <div className={css.posMeta}>{f.contract} · entry {f.entry} · stop {f.stop} · tgt {f.tgt} · {f.at} ET</div>
              </div>
            ))}
          </section>

          <section className={css.panel}>
            <div className={css.panelHead}>Desk talk</div>
            {s.talk.map((t, i) => (
              <div className={css.feedRow} key={i}>
                <span className={css.feedAt}>{t.at}</span>
                <span>{t.msg}</span>
              </div>
            ))}
            <div className={css.panelHead} style={{ borderTop: '1px solid #103527' }}>
              Watching <span className={css.n}>{s.watching.length}</span>
            </div>
            {s.watching.map((w) => (
              <div className={css.watchRow} key={w.ticker}>
                <span className={css.tick} style={{ fontSize: 13 }}>{w.ticker}</span>
                <span style={{ color: '#8fb3a3' }}>{w.side} · {w.setup}</span>
                <span className={css.conf}>{w.grade} · {w.conf}%</span>
              </div>
            ))}
          </section>
        </div>

        <div className={css.foot}>MODELED PAPER TRADING · EDUCATIONAL · NOT FINANCIAL ADVICE</div>
      </div>
    </div>
  );
}
