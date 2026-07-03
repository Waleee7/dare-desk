// Serves the bot's state.json to the client shell — the dashboard polls this.
// The bot (a separate Node process) writes ../data/state.json after every tick;
// this route is the only bridge, so the two stay fully decoupled.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STATE_PATH = join(process.cwd(), '..', 'data', 'state.json');

export function GET(): NextResponse {
  if (!existsSync(STATE_PATH)) {
    return NextResponse.json(
      { error: 'no-state', message: 'No scan data yet — start the bot with `npm run go` (or `npm run scan` for one pass).' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    return new NextResponse(raw, {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'read-failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
