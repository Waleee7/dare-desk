// Signal dispatcher — routes a scored result to the right Discord feed:
//   SIGNAL (≥85%) → main signals webhook (rich embed) — the only tier that fires
//   WATCH  (65-84%) → "Watching" webhook (falls back to main) with watch phrasing
//   REJECT (<65%)  → not posted (dashboard only) — discipline: don't spam passes
// Stage 1 of the live-assistant upgrade.

import type { EvaluationResult } from '../pipeline.js';
import type { PremiumFloorAlert } from '../lib/types.js';
import { config } from '../lib/config.js';
import { postToDiscord, type DiscordEmbed } from './transport.js';

const COLOR = { fire: 0xa3e635, watch: 0xfbbf24, rej: 0x5a6473 };
export type Routed = 'signal' | 'watch' | 'rejected';

export async function dispatchSignal(res: EvaluationResult): Promise<Routed> {
  const a = res.alert;
  if (a.kind === 'rejection') return 'rejected';

  if (a.grade === 'SIGNAL') {
    await postToDiscord(config.discordWebhookUrl, signalContent(a), [signalEmbed(a, res)]);
    return 'signal';
  }
  const url = config.discordWatchWebhookUrl || config.discordWebhookUrl;
  await postToDiscord(url, watchContent(a), [watchEmbed(a, res)]);
  return 'watch';
}

const bias = (a: PremiumFloorAlert) => (a.direction === 'long' ? 'CALLS' : 'PUTS');
const fmt = (n: number | null) => (n == null ? '—' : String(n));
const contractStr = (a: PremiumFloorAlert) =>
  `${a.contract.ticker} ${a.contract.strike}${a.contract.optionType === 'call' ? 'C' : 'P'} ${a.contract.expiry || ''}`.trim();

function signalContent(a: PremiumFloorAlert): string {
  return `🚨 **${a.ticker} ${bias(a)}** — ${a.setup} · ${a.confidence}% confidence`;
}

function signalEmbed(a: PremiumFloorAlert, res: EvaluationResult): DiscordEmbed {
  const fw = res.firewall;
  return {
    title: `🚨 ${config.botName} · ${a.ticker} ${bias(a)}`,
    color: COLOR.fire,
    fields: [
      { name: 'Setup', value: a.setup, inline: true },
      { name: 'Confidence', value: `${a.confidence}% · 🚨 SIGNAL`, inline: true },
      { name: 'Trade length', value: a.tradeLength, inline: true },
      { name: 'Timeframes', value: res.idea.mtf ? `${res.idea.mtf.timeframes.join('+')} (${res.idea.mtf.agreement}/3)${res.idea.mtf.conflict ? ' ⚠️' : ''}` : '—', inline: true },
      { name: 'Contract', value: `${contractStr(a)}\n${a.contractStyle}`, inline: false },
      { name: 'Entry', value: fmt(a.entry), inline: true },
      { name: 'Stop', value: fmt(a.stop), inline: true },
      { name: 'Targets', value: a.targets.map(String).join(' / ') || '—', inline: true },
      { name: 'Size', value: `${fw.positionContracts}x · max $${fw.maxLossUsd}`, inline: true },
      { name: 'R:R', value: fw.rewardRisk != null ? fw.rewardRisk.toFixed(2) : '—', inline: true },
      { name: 'Status', value: a.status, inline: true },
      { name: 'Why', value: a.why.slice(0, 3).map((r) => `• ${r}`).join('\n') || '—' },
      { name: 'Market / News', value: a.newsContext },
      { name: 'Risk', value: a.risk },
    ],
    footer: { text: `${config.botName} · paper-first · not financial advice` },
    timestamp: new Date().toISOString(),
  };
}

function watchContent(a: PremiumFloorAlert): string {
  if (a.confidence >= 80) return `🔥 **Keep watching — ${a.ticker}** · ${a.confidence}%, close but under the 85% signal bar`;
  if (a.confidence >= 72) return `👀 **Keep watching — ${a.ticker}** · ${a.confidence}%, needs confirmation`;
  return `👀 Early watch — ${a.ticker} · ${a.confidence}%, alert if volume confirms`;
}

function watchEmbed(a: PremiumFloorAlert, res: EvaluationResult): DiscordEmbed {
  const note = a.confidence >= 80 ? 'Keep watching — close to the 85% signal bar' : a.confidence >= 72 ? 'Keep watching — needs confirmation' : 'Early — needs volume';
  return {
    title: `👀 ${a.ticker} ${bias(a)} — WATCHING`,
    description: `${note} · alert if volume confirms`,
    color: COLOR.watch,
    fields: [
      { name: 'Setup', value: a.setup, inline: true },
      { name: 'Confidence', value: `${a.confidence}%`, inline: true },
      { name: 'Trade length', value: a.tradeLength, inline: true },
      { name: 'Contract', value: `${contractStr(a)} · ${a.contractStyle}`, inline: false },
      { name: 'Levels', value: `entry ${fmt(a.entry)} · stop ${fmt(a.stop)} · tgt ${a.targets.map(String).join('/') || '—'}`, inline: false },
      { name: 'Market / News', value: a.newsContext },
    ],
    footer: { text: `${config.botName} · watchlist` },
    timestamp: new Date().toISOString(),
  };
}
