// TradingView (and generic) webhook receiver — the legit way to "use
// TradingView." Build setups in Pine Script, set an alert with a webhook URL
// pointing here, and TradingView POSTs the alert when it fires. Each alert flows
// through the SAME engine (parse → score → govern → firewall → Discord) using
// today's live market context.
//
// Run: `npm run webhook`  → POST http://127.0.0.1:4500/tradingview
// Expose publicly (ngrok / a host / Vercel function) and paste that URL into the
// TradingView alert's "Webhook URL" — wire at the end.

import http from 'node:http';
import { PremiumFloorEngine } from '../pipeline.js';
import { buildMarketContext } from '../context/marketContext.js';
import { makeProvider } from '../data/index.js';
import { dispatchSignal } from '../discord/dispatch.js';
import { fullUniverse } from '../scan/universe.js';
import { config } from '../lib/config.js';

/** Pull the alert text out of a TradingView payload (JSON {message|alert|text} or raw). */
function extractAlertText(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const v = j.message ?? j.alert ?? j.text ?? j.content;
    if (typeof v === 'string' && v.trim()) return v;
  } catch {
    // not JSON — treat the raw body as the alert
  }
  return body.trim();
}

export function startWebhookServer(port = Number(process.env.WEBHOOK_PORT) || 4500): http.Server {
  const engine = new PremiumFloorEngine();
  const provider = makeProvider();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && (req.url === '/tradingview' || req.url === '/alert')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const text = extractAlertText(body);
      if (!text) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'empty alert' }));
        return;
      }
      try {
        const ctx = await buildMarketContext(provider, fullUniverse());
        const r = await engine.evaluate(text, ctx, { source: 'tradingview' });
        await dispatchSignal(r);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ticker: r.idea.ticker,
          grade: r.decision.grade,
          total: r.decision.total,
          confidence: r.decision.confidence,
          fired: r.firewall.approved,
          status: r.alert.status,
          blocks: r.firewall.blocks,
        }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String((e as Error).message ?? e) }));
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.listen(port, () => {
    console.log(`TradingView webhook listening → POST http://127.0.0.1:${port}/tradingview`);
    console.log(`Health: GET http://127.0.0.1:${port}/health`);
    console.log(`Data feed: ${provider.name}${provider.realtime ? ' (real-time)' : ' (mock — add ALPACA keys)'}`);
  });
  return server;
}

startWebhookServer();
