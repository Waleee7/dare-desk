// Discord channel router — one server, many lanes:
//   #signals          — A+/A entries (the main feed; DISCORD_WEBHOOK_URL)
//   #watching         — B-grade setups (falls back to #signals)
//   #trade-management — exit monitor talk + EOD recap (falls back to #signals)
//   #news             — breaking headlines (SILENT when unset — news never spams signals)
//   #mag7 / #spy-qqq  — ticker-bucket CROSS-POSTS of fires (optional, additive)
// Every channel is a webhook URL in .env; unset lanes degrade instead of erroring.

import { config } from '../lib/config.js';
import { postToDiscord, type DiscordEmbed } from './transport.js';
import { isIndex, FOCUS } from '../scan/universe.js';

/** The bucket channel a ticker's fires ALSO post into ('' = no bucket configured). */
export function bucketWebhook(ticker: string): string {
  const t = ticker.toUpperCase();
  if (isIndex(t)) return config.discordIndexWebhookUrl;
  if (FOCUS.has(t)) return config.discordMag7WebhookUrl;
  return '';
}

/** A fired signal: main #signals + the ticker's bucket channel (if configured). */
export async function postSignal(ticker: string, content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
  const main = await postToDiscord(config.discordWebhookUrl, content, embeds);
  const bucket = bucketWebhook(ticker);
  if (bucket && bucket !== config.discordWebhookUrl) {
    await postToDiscord(bucket, content, embeds);
  }
  return main;
}

/** A watch-grade setup: #watching, falling back to the main feed. */
export async function postWatch(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
  return postToDiscord(config.discordWatchWebhookUrl || config.discordWebhookUrl, content, embeds);
}

/** Exit-monitor talk + recaps: #trade-management, falling back to the main feed. */
export async function postTradeMgmt(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
  return postToDiscord(config.discordTradeMgmtWebhookUrl || config.discordWebhookUrl, content, embeds);
}

/** Breaking news: #news ONLY — a missing news channel means silence, not spam. */
export async function postNews(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
  if (!config.discordNewsWebhookUrl) return false;
  return postToDiscord(config.discordNewsWebhookUrl, content, embeds);
}

/** ARMED pre-trigger heads-up: #armed, falling back to the main signals feed. */
export async function postArmed(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
  return postToDiscord(config.discordArmedWebhookUrl || config.discordWebhookUrl, content, embeds);
}
