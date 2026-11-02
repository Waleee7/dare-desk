// Serves the bot's state.json to the client shell — the dashboard polls this.
// The bot (a separate Node process) writes ../data/state.json after every tick;
// this route is the only bridge, so the two stay fully decoupled.
//
// DEMO MODE: serves a deterministic, synthetic state (src/demo/seed.ts) when
//   - DARE_DESK_DEMO=1 is set, or
//   - the request carries ?demo=1, or
//   - there is no data/state.json yet (a fresh clone still shows something real-looking).
// Demo responses always carry `demo: true`; the UI labels them DEMO DATA.
// ?tick=N picks the frame of the scripted scenario (default 0).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { buildDemoState } from '../../../../src/demo/seed';

export const dynamic = 'force-dynamic';

const STATE_PATH = join(process.cwd(), '..', 'data', 'state.json');
const NO_STORE = { 'cache-control': 'no-store' };

export function GET(req: NextRequest): NextResponse {
  const q = req.nextUrl.searchParams;
  const forced = process.env.DARE_DESK_DEMO === '1' || q.get('demo') === '1';
  if (forced || !existsSync(STATE_PATH)) {
    const tick = Number.parseInt(q.get('tick') ?? '0', 10);
    return NextResponse.json(buildDemoState({ tick: Number.isFinite(tick) ? tick : 0 }), { headers: NO_STORE });
  }
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    return new NextResponse(raw, { headers: { 'content-type': 'application/json', ...NO_STORE } });
  } catch {
    return NextResponse.json({ error: 'read-failed' }, { status: 500, headers: NO_STORE });
  }
}
