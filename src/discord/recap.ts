// EOD auto-recap — an end-of-day review posted to Discord: what fired, expectancy in
// R multiples (by regime), and prove-it status. Performance CLAIMS are gated by
// claimsAllowed() (>=100 paper trades + positive expectancy + no losing regime
// bucket). Until then it reports raw evidence with NO profitability claim.

import type { ExpectancyStats } from '../lib/types.js';
import { config } from '../lib/config.js';
import { claimsAllowed } from '../backtest/index.js';
import { type DiscordEmbed } from './transport.js';
import { postTradeMgmt } from './router.js';

const signedR = (r: number): string => `${r >= 0 ? '+' : ''}${r}R`;

export interface RecapInput {
  date: string; // YYYY-MM-DD
  botName: string;
  summary: { total: number; alerted: number; watched: number; skipped: number; topBlocks: string[] };
  expectancy: ExpectancyStats;
}

export function buildEodRecap(input: RecapInput): { text: string; embed: DiscordEmbed } {
  const { summary: s, expectancy: e, botName } = input;
  const proven = claimsAllowed(e);
  const claimLine = proven
    ? `✅ Prove-it gate PASSED — ${e.trades} paper trades, expectancy ${signedR(e.expectancyR)}, PF ${e.profitFactor}. Performance claims unlocked.`
    : `🔒 Prove-it gate: ${e.trades}/${config.risk.minPaperTrades} paper trades logged. Evidence only — NO profitability claims yet.`;

  const text = [
    `📓 **${botName} — EOD Recap · ${input.date}**`,
    '',
    `Evaluated: ${s.total} · fired: ${s.alerted} · watch: ${s.watched} · filtered: ${s.skipped}`,
    `Closed paper trades: ${e.trades}${e.trades ? ` · win ${(e.winRate * 100).toFixed(0)}% · expectancy ${signedR(e.expectancyR)} · avg hold ${e.avgHoldMinutes}m` : ''}`,
    e.trades ? `By regime — up ${signedR(e.byRegime.up.expectancyR)} (${e.byRegime.up.trades}) · down ${signedR(e.byRegime.down.expectancyR)} (${e.byRegime.down.trades}) · flat ${signedR(e.byRegime.flat.expectancyR)} (${e.byRegime.flat.trades})` : '',
    s.topBlocks.length ? `Top filters: ${s.topBlocks.join(' · ')}` : '',
    '',
    claimLine,
    '_Modeled paper fills — estimates, not live execution. Not financial advice._',
  ].filter(Boolean).join('\n');

  const embed: DiscordEmbed = {
    title: `📓 ${botName} — EOD Recap · ${input.date}`,
    color: proven ? 0x34d399 : 0xfbbf24,
    fields: [
      { name: 'Signals', value: `fired ${s.alerted} · watch ${s.watched} · filtered ${s.skipped} / ${s.total}`, inline: false },
      { name: 'Paper trades', value: `${e.trades}`, inline: true },
      { name: 'Expectancy', value: e.trades ? signedR(e.expectancyR) : '—', inline: true },
      { name: 'Win rate', value: e.trades ? `${(e.winRate * 100).toFixed(0)}%` : '—', inline: true },
      { name: 'Prove-it gate', value: proven ? '✅ passed' : `🔒 ${e.trades}/${config.risk.minPaperTrades}`, inline: false },
    ],
    footer: { text: `${botName} · modeled paper · not financial advice` },
    timestamp: new Date().toISOString(),
  };
  return { text, embed };
}

/** Post the EOD recap to #trade-management (falls back to main). False if unconfigured. */
export async function postEodRecap(input: RecapInput): Promise<boolean> {
  const { text, embed } = buildEodRecap(input);
  return postTradeMgmt(text, [embed]);
}
