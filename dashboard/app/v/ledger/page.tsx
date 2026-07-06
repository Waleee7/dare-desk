import Switcher from '../Switcher';
import { sample as s } from '../sample';
import css from './ledger.module.css';

export const metadata = { title: 'Preview · The Ledger' };

export default function LedgerPreview() {
  return (
    <div className={css.page}>
      <Switcher active="ledger" />

      <header className={css.mast}>
        <div className={css.mastInner}>
          <div className={css.brandRow}>
            <div className={css.brand}>DARE <em>DESK</em></div>
            <span className={css.spacer} />
            <span className={css.live}>LIVE · {s.tape}</span>
          </div>
          <div className={css.heroRow}>
            <div>
              <div className={css.heroLabel}>Today's result</div>
              <div className={css.heroNum}>+${s.dayPnl.toFixed(2)}</div>
            </div>
            <div className={css.heroSub}>
              peak +${s.peak.toFixed(0)} · {s.positionsOn} positions on · risk ${s.openRisk} at stop
              <br />prove-it {s.proveIt.done}/{s.proveIt.needed} paper trades
            </div>
          </div>
        </div>
      </header>
      <nav className={css.nav}>
        <div className={css.navInner}>
          <a className={css.on} href="#">Today</a>
          <a href="#">Charts</a>
          <a href="#">History</a>
          <a href="#">Performance</a>
          <a href="#">News</a>
        </div>
      </nav>

      <main className={css.body}>
        <div className={css.rule}><h2>Positions on</h2><span className={css.count}>{s.positions.length}</span></div>
        {s.positions.map((p) => (
          <div className={css.row} key={p.ticker}>
            <div>
              <div className={css.tick}>{p.ticker}</div>
              <div className={css.side}>{p.side}</div>
            </div>
            <div>
              <div className={css.what}>
                {p.qty}
                <span className={css.grade}>{p.grade}</span>
              </div>
              <div className={css.meta}>
                in {p.in} · mark ${p.mark.toFixed(2)} · stop ${p.stop.toFixed(2)} · TP {p.tp1.toFixed(2)} / {p.tp2.toFixed(2)} — {p.status}
              </div>
            </div>
            <div className={css.pl}>
              <div className={`${css.plMain} ${p.plUsd >= 0 ? css.pos : css.neg}`}>
                {p.plUsd >= 0 ? '+' : '−'}${Math.abs(p.plUsd).toFixed(2)}
              </div>
              <div className={css.plSub}>{p.plPct >= 0 ? '+' : ''}{p.plPct}%</div>
            </div>
          </div>
        ))}

        <div className={css.rule}><h2>Desk notes</h2></div>
        {s.talk.map((t, i) => (
          <div className={css.talkRow} key={i}>
            <span className={css.talkAt}>{t.at}</span>
            <span>{t.msg}</span>
          </div>
        ))}

        <div className={css.rule}><h2>Fired today</h2><span className={css.count}>{s.fired.length}</span></div>
        {s.fired.map((f) => (
          <div className={css.row} key={f.ticker}>
            <div>
              <div className={css.tick}>{f.ticker}</div>
              <div className={css.side}>{f.side}</div>
            </div>
            <div>
              <div className={css.what}>{f.setup}<span className={css.grade}>{f.grade} · {f.conf}%</span></div>
              <div className={css.meta}>{f.contract} · entry {f.entry} · stop {f.stop} · targets {f.tgt} · {f.at} ET</div>
            </div>
            <div />
          </div>
        ))}

        <div className={css.rule}><h2>Watching</h2><span className={css.count}>{s.watching.length}</span></div>
        {s.watching.map((w) => (
          <div className={css.row} key={w.ticker} style={{ opacity: 0.7 }}>
            <div>
              <div className={css.tick}>{w.ticker}</div>
              <div className={css.side}>{w.side}</div>
            </div>
            <div><div className={css.what}>{w.setup}<span className={css.grade}>{w.grade} · {w.conf}%</span></div></div>
            <div />
          </div>
        ))}

        <div className={css.foot}>Modeled paper trading · educational · not financial advice</div>
      </main>
    </div>
  );
}
