// Signal dispatcher — routes a scored result to the right Discord feed by band + tier:
//   A+ (≥90)  → main signals webhook — fires, leans in (the Extended-universe bar)
//   A  (≥80)  → main signals webhook — fires (Core/Focus only)
//   B  (≥70)  → "Watching" webhook (falls back to main) with watch phrasing
//   C / D     → not posted (dashboard only) — discipline: don't spam passes

import type { EvaluationResult } from '../pipeline.js';
import type { PremiumFloorAlert } from '../lib/types.js';
import { config } from '../lib/config.js';
import { postToDiscord, type DiscordEmbed } from './transport.js';

const COLOR = { aplus: 0xf97316, fire: 0xa3e635, watch: 0xfbbf24, rej: 0x5a6473 };
export type Routed = 'signal' | 'watch' | 'rejected';

export async function dispatchSignal(res: EvaluationResult): Promise<Routed> {
  const a = res.alert;
  if (a.kind === 'rejection') return 'rejected';

  // Fire to the main signals channel: A+ always; A only for Core/Focus (Extended
  // must clear A+, which the firewall already enforces upstream). B → watch feed.
  const fires = a.grade === 'A+' || (a.grade === 'A' && a.tier !== 'extended');
  if (fires) {
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

const isAplus = (a: PremiumFloorAlert) => a.grade === 'A+';
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;

function signalContent(a: PremiumFloorAlert): string {
  const tag = isAplus(a) ? '🔥🔥 **A+**' : '🚨';
  return `${tag} **${a.ticker} ${bias(a)}** — ${a.setup} · ${a.confidence}% confidence`;
}

/** Compact Exit Brain block for the embed. */
function exitValue(a: PremiumFloorAlert): string {
  const ep = a.exitPlan;
  const lines = [`⏱ ${ep.holdWindow}`];
  for (const tp of ep.takeProfits) lines.push(`${tp.label}: ${signed(tp.premiumPct)} (~$${tp.premium}) — ${tp.action}`);
  lines.push(`🛑 ${ep.stop.label}: ${signed(ep.stop.premiumPct)} (~$${ep.stop.premium})`);
  lines.push(`🏃 ${ep.runnerTrigger}`);
  lines.push(`❌ ${ep.invalidation}`);
  return lines.join('\n');
}

function signalEmbed(a: PremiumFloorAlert, res: EvaluationResult): DiscordEmbed {
  const fw = res.firewall;
  const aplus = isAplus(a);
  return {
    title: `${aplus ? '🔥 A+' : '🚨'} ${config.botName} · ${a.ticker} ${bias(a)}`,
    color: aplus ? COLOR.aplus : COLOR.fire,
    fields: [
      { name: 'Setup', value: a.setup, inline: true },
      { name: 'Confidence', value: `${a.confidence}% · ${aplus ? '🔥 A+' : '🚨 A'}`, inline: true },
      { name: 'Trade length', value: a.tradeLength, inline: true },
      { name: 'Timeframes', value: res.idea.mtf ? `${res.idea.mtf.timeframes.join('+')} (${res.idea.mtf.agreement}/3)${res.idea.mtf.conflict ? ' ⚠️' : ''}` : '—', inline: true },
      { name: 'Contract', value: `${contractStr(a)}\n${a.contractStyle}`, inline: false },
      { name: 'Tier', value: a.tier.toUpperCase(), inline: true },
      { name: '⏰ Entry @', value: `${a.entryTimeEt} ET · flat ${a.timeToFlat}`, inline: true },
      { name: '💵 Cost (modeled)', value: a.costPaidUsd != null ? `$${a.costPerContractUsd}/ct · $${a.costPaidUsd}` : '—', inline: true },
      { name: 'Entry', value: fmt(a.entry), inline: true },
      { name: 'Stop', value: fmt(a.stop), inline: true },
      { name: 'Targets', value: a.targets.map(String).join(' / ') || '—', inline: true },
      { name: '🎯 Exit plan', value: exitValue(a), inline: false },
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
  if (a.confidence >= 76) return `🔥 **Keep watching — ${a.ticker}** · ${a.confidence}%, knocking on the 80% signal bar`;
  if (a.confidence >= 70) return `👀 **Keep watching — ${a.ticker}** · ${a.confidence}%, needs confirmation`;
  return `👀 Early watch — ${a.ticker} · ${a.confidence}%, alert if volume confirms`;
}

function watchEmbed(a: PremiumFloorAlert, res: EvaluationResult): DiscordEmbed {
  const note = a.confidence >= 76 ? 'Knocking on the 80% signal bar' : a.confidence >= 70 ? 'Keep watching — needs confirmation' : 'Early — needs volume';
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
