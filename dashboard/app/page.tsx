import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Terminal from './components/Terminal';

// Re-read the bot's state file on every request (written by `npm run scan` / `go`).
export const dynamic = 'force-dynamic';

function loadState(): unknown {
  const p = join(process.cwd(), '..', 'data', 'state.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export default function Page() {
  return <Terminal state={loadState() as never} />;
}
