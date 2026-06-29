// Discord transport — posts content and/or rich embeds via a webhook URL.
// No-op (returns false) when unconfigured so the engine still runs.

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number; // decimal RGB
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export async function postToDiscord(
  webhookUrl: string,
  content: string,
  embeds?: DiscordEmbed[],
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const body: Record<string, unknown> = {};
    if (content) body.content = content.slice(0, 1990); // Discord 2000-char cap
    if (embeds?.length) body.embeds = embeds.slice(0, 10);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
