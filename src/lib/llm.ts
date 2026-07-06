// Anthropic LLM access. One helper: `structuredCall` runs a cached-system,
// adaptive-thinking request and returns Zod-validated structured output, or
// null on any failure (callers fall back to deterministic heuristics so the
// engine is never hard-down on a missing key or a transient API error).

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { config, hasLLM } from './config.js';
import { isClockFrozen } from './clock.js';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!hasLLM()) return null;
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

export interface StructuredOpts {
  /** Stable, reusable instruction block — cached as a prompt prefix. */
  system: string;
  /** Volatile, per-request content (the actual trade idea / context). */
  user: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxTokens?: number;
}

/**
 * Returns parsed output validated against `schema`, or null on no-key / error.
 * The system prompt is sent as a cached block; the per-request user content
 * stays after it so the cache prefix is reused across calls.
 */
export async function structuredCall<S extends z.ZodType>(
  schema: S,
  opts: StructuredOpts,
): Promise<z.infer<S> | null> {
  // Replay: heuristics only — an LLM call per candidate per tick would be slow,
  // costly, and non-deterministic (breaking reproducible backtests).
  if (isClockFrozen()) return null;
  const c = getClient();
  if (!c) return null;

  try {
    const res = await c.messages.parse({
      model: opts.model ?? config.scorerModel,
      max_tokens: opts.maxTokens ?? 2048,
      thinking: { type: 'adaptive' },
      system: [
        { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: zodOutputFormat(schema),
        effort: opts.effort ?? config.scorerEffort,
      },
      messages: [{ role: 'user', content: opts.user }],
    });
    return (res.parsed_output as z.infer<S>) ?? null;
  } catch {
    // Network / auth / refusal / schema miss → let the caller's heuristic run.
    return null;
  }
}
