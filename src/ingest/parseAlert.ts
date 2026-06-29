// Component 1 — ingestion. Turn a raw alert into a structured TradeIdea.
// LLM parse (structured) with a deterministic regex fallback so ingestion
// works offline.

import { z } from 'zod';
import type { RawAlert, TradeIdea, Direction, OptionType } from '../lib/types.js';
import { structuredCall } from '../lib/llm.js';
import { config } from '../lib/config.js';

const ParseSchema = z.object({
  ticker: z.string(),
  optionType: z.enum(['call', 'put']),
  strike: z.number().nullable(),
  expiry: z.string().nullable(),
  setup: z.string(),
  entry: z.number().nullable(),
  stop: z.number().nullable(),
  targets: z.array(z.number()),
  premium: z.number().nullable(),
  catalyst: z.string().nullable(),
  rawConfidence: z.number().nullable(),
});

const PARSE_SYSTEM = `You parse raw options-trading alerts (Schwab/Discord style) into structured JSON.
Extract only what is present; use null when a field is absent. Do not invent values.
- ticker: the underlying symbol (uppercase).
- optionType: "call" or "put" (calls = bullish, puts = bearish).
- strike, expiry (YYYY-MM-DD if given), entry (underlying), stop (underlying), targets (underlying), premium (option price).
- setup: short phrase for the play (e.g. "unusual flow", "VWAP reclaim", "RSI oversold", "breakout").
- catalyst: any news/flow note. rawConfidence: the bot's own 0-10 confidence if stated.`;

export async function parseAlert(alert: RawAlert): Promise<TradeIdea> {
  const parsed = await structuredCall(ParseSchema, {
    system: PARSE_SYSTEM,
    user: `Alert:\n${alert.text}`,
    model: config.parserModel,
    effort: 'low',
  });

  if (parsed) {
    return toIdea(alert, {
      ticker: parsed.ticker.toUpperCase(),
      optionType: parsed.optionType,
      strike: parsed.strike,
      expiry: parsed.expiry,
      setup: parsed.setup,
      entry: parsed.entry,
      stop: parsed.stop,
      targets: parsed.targets,
      premium: parsed.premium,
      catalyst: parsed.catalyst ?? undefined,
      rawConfidence: parsed.rawConfidence ?? undefined,
    });
  }

  return heuristicParse(alert);
}

function toIdea(
  alert: RawAlert,
  p: {
    ticker: string;
    optionType: OptionType;
    strike: number | null;
    expiry: string | null;
    setup: string;
    entry: number | null;
    stop: number | null;
    targets: number[];
    premium: number | null;
    catalyst?: string;
    rawConfidence?: number;
  },
): TradeIdea {
  const direction: Direction = p.optionType === 'call' ? 'long' : 'short';
  return {
    alertId: alert.id,
    ticker: p.ticker,
    direction,
    setup: p.setup || 'unspecified',
    contract: {
      ticker: p.ticker,
      optionType: p.optionType,
      strike: p.strike ?? 0,
      expiry: p.expiry ?? '',
    },
    entry: p.entry,
    stop: p.stop,
    targets: p.targets ?? [],
    premium: p.premium,
    catalyst: p.catalyst,
    rawConfidence: p.rawConfidence,
  };
}

/** Best-effort offline parse: enough to keep the pipeline + demo alive. */
export function heuristicParse(alert: RawAlert): TradeIdea {
  const t = alert.text;
  const ticker = (t.match(/\b[A-Z]{1,5}\b/)?.[0] ?? 'SPY').toUpperCase();
  const optionType: OptionType = /\bput|puts|bear/i.test(t) ? 'put' : 'call';
  const strike = numAfter(t, /(?:strike|@|\$)\s*([0-9]+(?:\.[0-9]+)?)/i)
    ?? numAfter(t, /\b([0-9]{2,4})\s*(?:c|p|call|put)\b/i);
  const entry = numAfter(t, /entry[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  // Honor an explicit "no stop"; the naive regex would otherwise grab the next number.
  const stop = /no\s+stop|without\s+a?\s*stop/i.test(t)
    ? null
    : numAfter(t, /stop[^a-z0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  const targets = [...t.matchAll(/(?:target|tgt|pt)[^0-9]*([0-9]+(?:\.[0-9]+)?)/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  // Require the number to sit right after the label (don't let "the ask ..." or
  // other prose pull a far-away price in as the premium).
  const premium = numAfter(t, /(?:premium|prem)\s*[:=@]?\s*\$?([0-9]+(?:\.[0-9]+)?)/i);
  const setup = /unusual|flow/i.test(t) ? 'unusual flow'
    : /vwap/i.test(t) ? 'VWAP reclaim'
    : /rsi/i.test(t) ? 'RSI signal'
    : /break/i.test(t) ? 'breakout'
    : 'unspecified';

  return toIdea(alert, {
    ticker, optionType, strike, expiry: null, setup,
    entry, stop, targets, premium,
  });
}

function numAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
