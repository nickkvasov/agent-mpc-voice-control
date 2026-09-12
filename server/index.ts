import { createServer } from 'node:http';

/**
 * Backend scaffold. It exists for the three things the browser must not hold:
 * the Anthropic key, the YouTube key, and the shared search quota.
 *
 * Routes land in T023-T026. This file currently serves only a liveness probe,
 * and deliberately answers 404 for everything else rather than a placeholder
 * 200 — an endpoint that answers before it is implemented is the silent
 * success IMMUNE-U forbids.
 */
const PORT = Number(process.env['PORT'] ?? 8787);

export const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, reason: 'not_implemented', detail: `No route for ${req.method} ${req.url}` }));
});

// Only listen when run directly, so tests can import the server without
// binding a port.
if (process.argv[1]?.endsWith('index.ts') === true || process.argv[1]?.endsWith('index.js') === true) {
  server.listen(PORT, () => {
    process.stdout.write(`backend listening on http://localhost:${PORT}\n`);
  });
}
