import Switcher from '../Switcher';
import { sample as s } from '../sample';
import css from './broker.module.css';

export const metadata = { title: 'Preview · Clean Broker' };

export default function BrokerPreview() {
  return (
    <div className={css.page}>
      <Switcher active="broker" />
      <div className={css.wrap}>
        <div className={css.top}>
          <div className={css.brand}>Dare<span>Desk</span></div>
          <div className={css.live}>● Live · {s.tape}</div>
        </div>

        <div className={css.hero}>
          <div className={css.heroLabel}>Today</div>
          <div className={css.heroNum}>+${s.dayPnl.toFixed(2)}</div>
          <div className={css.heroSub}>
            {s.positionsOn} trades on · peaked at +${s.peak.toFixed(0)} · {s.proveIt.done} of {s.proveIt.needed} practice trades done
          </div>
        </div>

        <div className={css.seg}>
          <button className={css.on}>Today</button>
          <button>Charts</button>
          <button>History</button>
          <button>Results</button>
          <button>News</button>
        </div>

        <div className={css.h}>Open trades</div>
        {s.positions.map((p) => (
          <div className={css.item} key={p.ticker}>
            <div className={`${css.avatar} ${p.plUsd < 0 ? css.red : ''}`}>{p.ticker}</div>
            <div className={css.itemBody}>
              <div className={css.itemTitle}>
                {p.ticker} {p.side.toLowerCase()}
                {p.grade === 'A+' ? <span className={css.aplus}>A+ conviction</span> : null}
              </div>
              <div className={css.itemSub}>{p.qty} · {p.status}</div>
            </div>
            <div className={css.itemRight}>
              <div className={`${css.big} ${p.plUsd >= 0 ? css.pos : css.neg}`}>
                {p.plUsd >= 0 ? '+' : '−'}${Math.abs(p.plUsd).toFixed(2)}
              </div>
              <div className={css.small}>{p.plPct >= 0 ? '+' : ''}{p.plPct}%</div>
            </div>
          </div>
        ))}

        <div className={css.h}>What the desk is saying</div>
        {s.talk.map((t, i) => (
          <div className={css.note} key={i}>
            <div className={css.noteAt}>{t.at} ET</div>
            {t.msg}
          </div>
        ))}

        <div className={css.h}>New signals</div>
        {s.fired.map((f) => (
          <div className={css.item} key={f.ticker}>
            <div className={css.avatar}>{f.ticker}</div>
            <div className={css.itemBody}>
              <div className={css.itemTitle}>{f.ticker} {f.side.toLowerCase()} <span className={css.aplus}>A+ · {f.conf}%</span></div>
              <div className={css.itemSub}>{f.setup} — {f.contract}, entry {f.entry}, stop {f.stop}</div>
            </div>
          </div>
        ))}

        <div className={css.h}>Keeping an eye on</div>
        {s.watching.map((w) => (
          <div className={css.item} key={w.ticker}>
            <div className={css.avatar} style={{ opacity: 0.65 }}>{w.ticker}</div>
            <div className={css.itemBody}>
              <div className={css.itemTitle}>{w.ticker} {w.side.toLowerCase()} <span className={css.gradeB}>{w.grade} · {w.conf}%</span></div>
              <div className={css.itemSub}>{w.setup} — needs confirmation first</div>
            </div>
          </div>
        ))}

        <div className={css.foot}>Practice trading with modeled fills · educational · not financial advice</div>
      </div>
    </div>
  );
}
