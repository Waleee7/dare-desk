// Degraded-mode options-flow layer. FREE/DELAYED chain only — everything here is
// DERIVED from a ~15-minute-delayed options chain (volume + open interest). There
// is NO real-time sweep/block tape, so we never fabricate one. `delayed` is always
// true and every snapshot carries an honest `note`. Providers implement this; the
// factory (index.ts) tries a free feed and returns null on any failure.

/** One strike whose volume is unusually large vs its resting open interest
 *  (volOiRatio > 2). This is the honest, delayed proxy for "unusual activity" —
 *  it is NOT a confirmed sweep/block (we can't see the tape on free data). */
export interface UnusualStrike {
  strike: number;
  type: 'call' | 'put';
  volume: number;
  openInterest: number;
  volOiRatio: number;
}

/** A delayed-chain snapshot for one ticker. All fields are computed from the
 *  free chain; none imply real-time order flow. */
export interface ChainSnapshot {
  ticker: string;
  delayed: boolean; // ALWAYS true on this layer
  asOf: string; // ISO — chain timestamp (or fetch time if the feed omits it)
  unusualStrikes: UnusualStrike[]; // vol/OI > 2, high-to-low
  highestVolumeStrikes: number[]; // top strikes by today's volume
  putCallVolRatio: number | null; // put vol / call vol (null when no call volume)
  gammaMagnets: number[]; // rough OI-cluster levels price tends to pin toward
  netFlowBias: 'bullish' | 'bearish' | 'mixed'; // call- vs put-volume tilt
  note: string; // honesty disclaimer — always states the data is delayed
}

/** A source of delayed options-chain snapshots. `snapshot` NEVER throws — it
 *  returns null on any error, missing data, or (if wired) missing key. */
export interface OptionsChainProvider {
  name: string;
  snapshot(ticker: string): Promise<ChainSnapshot | null>;
}
