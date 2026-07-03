'use client';

// News — the verified headline feed. Breaking items wear the badge; everything
// carries its source. No feed configured = an honest empty state, never filler.

import type { DashboardState } from '../lib/types';
import { timeAgo } from '../lib/format';

export default function NewsTab({ state }: { state: DashboardState }) {
  const rows = state.news ?? [];
  const contextHeadlines = state.headlines;

  return (
    <div>
      <div className="section-label">Breaking &amp; fresh</div>
      {rows.length === 0 ? (
        <div className="empty">
          No fresh headlines this session.
          {state.meta.newsProvider === 'none' && (
            <>
              <br /><span className="faint">No news feed configured — add Alpaca (or Finnhub/FMP) keys to go live.</span>
            </>
          )}
        </div>
      ) : (
        <div className="card">
          {rows.map((n, i) => (
            <div className="feed-item" key={i}>
              {n.breaking && <span className="news-breaking">BRK</span>}
              <span className="when">{timeAgo(n.at)}</span>
              <span>
                {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a> : n.headline}
                <span className="faint"> · {n.source}</span>
                {n.symbols.length > 0 && <span className="num dim"> [{n.symbols.slice(0, 3).join(' ')}]</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {contextHeadlines.length > 0 && (
        <>
          <div className="section-label">Market context</div>
          <div className="card">
            {contextHeadlines.map((h, i) => (
              <div className="feed-item" key={i}><span>{h}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
