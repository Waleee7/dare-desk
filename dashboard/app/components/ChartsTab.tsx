'use client';

// Charts — the pro screen. Pick a ticker, pick a timeframe, and read the whole
// picture: candles + volume, the walls drawn on the chart, the higher-timeframe
// trend stack, RVOL, options flow, and that ticker's headlines.

import { useMemo, useState } from 'react';
import type { DashboardState, TickerIntel } from '../lib/types';
import { arrow, signedPct } from '../lib/format';
import PriceChart, { levelLines } from './PriceChart';

const TFS = ['5m', '1h', '1D'] as const;
type Tf = (typeof TFS)[number];

export default function ChartsTab({
  state, ticker, onTicker,
}: { state: DashboardState; ticker: string; onTicker: (t: string) => void }) {
  const intel = state.intel ?? {};
  const tickers = Object.keys(intel).sort((a, b) => a.localeCompare(b));
  const active = intel[ticker] ? ticker : tickers[0] ?? '';
  const info: TickerIntel | undefined = intel[active];
  const [tf, setTf] = useState<Tf>('5m');

  const lines = useMemo(() => levelLines(info?.levels ?? null), [info?.levels]);
  const tickerNews = (state.news ?? []).filter((n) => n.symbols.some((s) => s.toUpperCase() === active));

  if (!info) {
    return <div className="empty" style={{ marginTop: 24 }}>No intel yet — run a scan first.</div>;
  }

  return (
    <div>
      <div className="ticker-strip" style={{ marginTop: 12 }}>
        {tickers.map((t) => (
          <button key={t} className={t === active ? 'active' : ''} onClick={() => onTicker(t)}>{t}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ alignItems: 'center', padding: '2px 6px 8px' }}>
          <b className="num" style={{ fontSize: 18 }}>{active}</b>
          {info.price != null && <span className="num dim">{info.price.toFixed(2)}</span>}
          <span className="spacer" />
          <div className="tf-switch">
            {TFS.map((t) => (
              <button key={t} className={t === tf ? 'active' : ''} onClick={() => setTf(t)}>{t}</button>
            ))}
          </div>
        </div>
        <PriceChart bars={info.bars[tf] ?? []} lines={lines} />
      </div>

      {info.trend && (
        <>
          <div className="section-label">Trend stack</div>
          <div className="card">
            <div className="trend-strip">
              {info.trend.timeframes.map((t) => (
                <span className="trend-chip" key={t.label}>
                  <span className="tf">{t.label}</span>
                  <span className={t.dir === 'up' ? 'up' : t.dir === 'down' ? 'down' : 'dim'}>{arrow(t.dir)}</span>
                  {t.rsi != null && <span className="faint">rsi {t.rsi}</span>}
                </span>
              ))}
              <span className="trend-chip" style={{
                color: info.trend.alignment === 'aligned-up' ? 'var(--green)'
                  : info.trend.alignment === 'aligned-down' ? 'var(--red)' : 'var(--text-dim)',
              }}>
                {info.trend.alignment === 'aligned-up' ? 'STACKED ↑'
                  : info.trend.alignment === 'aligned-down' ? 'STACKED ↓' : 'MIXED'}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="section-label">Tape &amp; positioning</div>
      <div className="kv" style={{ marginBottom: 10 }}>
        <div className="item">
          <div className="k">RVOL</div>
          <div className={`v ${info.rvol?.rvol != null && info.rvol.rvol >= 1.5 ? 'up' : info.rvol?.rvol != null && info.rvol.rvol < 0.6 ? 'down' : ''}`}>
            {info.rvol?.rvol != null ? `${info.rvol.rvol.toFixed(2)}x` : '—'}
          </div>
        </div>
        <div className="item">
          <div className="k">Flow bias</div>
          <div className={`v ${info.chain?.netFlowBias === 'bullish' ? 'up' : info.chain?.netFlowBias === 'bearish' ? 'down' : ''}`}>
            {info.chain?.netFlowBias ?? '—'}
          </div>
        </div>
        <div className="item">
          <div className="k">Put/Call vol</div>
          <div className="v">{info.chain?.putCallVolRatio ?? '—'}</div>
        </div>
        <div className="item">
          <div className="k">Call wall</div>
          <div className="v" style={{ color: 'var(--gold-bright)' }}>{info.chain?.callWall ?? '—'}</div>
        </div>
        <div className="item">
          <div className="k">Put wall</div>
          <div className="v" style={{ color: 'var(--gold-bright)' }}>{info.chain?.putWall ?? '—'}</div>
        </div>
        <div className="item">
          <div className="k">PDH / PDL</div>
          <div className="v">{info.levels?.prevDayHigh ?? '—'} / {info.levels?.prevDayLow ?? '—'}</div>
        </div>
      </div>

      {(info.chain?.unusualStrikes.length ?? 0) > 0 && (
        <div className="card">
          <div className="k faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
            Unusual strikes (delayed vol/OI)
          </div>
          {info.chain!.unusualStrikes.map((u, i) => (
            <div className="row num" key={i} style={{ fontSize: 13, padding: '3px 0' }}>
              <span>${u.strike} {u.type === 'call' ? 'C' : 'P'}</span>
              <span className="spacer" />
              <span className="dim">{u.volOiRatio}x vol/OI</span>
            </div>
          ))}
          <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>{info.chain!.note}</div>
        </div>
      )}

      {info.rvol && <div className="faint" style={{ fontSize: 12, margin: '4px 2px' }}>{info.rvol.note}{signedFromEma(info)}</div>}

      {tickerNews.length > 0 && (
        <>
          <div className="section-label">{active} headlines</div>
          <div className="card">
            {tickerNews.slice(0, 6).map((n, i) => (
              <div className="feed-item" key={i}>
                {n.breaking && <span className="news-breaking">BRK</span>}
                <span>
                  {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a> : n.headline}
                  <span className="faint"> · {n.source}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function signedFromEma(info: TickerIntel): string {
  const daily = info.trend?.timeframes.find((t) => t.label === '1D');
  return daily?.pctFromEmaSlow != null ? ` · ${signedPct(daily.pctFromEmaSlow)} vs 1D EMA21` : '';
}
