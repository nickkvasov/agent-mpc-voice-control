import { createServer } from 'node:http';
import { CatalogSearch } from './catalog-proxy/search.ts';
import { SearchQuota } from './catalog-proxy/quota.ts';
import { handle, requestUrl, writeReply, type RouteDeps } from './routes.ts';

/**
 * Backend scaffold. It exists for the three things the browser must not hold:
 * the Anthropic key, the YouTube key, and the shared search quota.
 *
 * Unimplemented paths answer 404 with a typed reason rather than a placeholder
 * 200 — an endpoint that answers before it is implemented is the silent success
 * IMMUNE-U forbids.
 */
const PORT = Number(process.env['PORT'] ?? 8787);

export function createDeps(): RouteDeps {
  const quota = new SearchQuota();
  return {
    gatewayOrigin: process.env['GATEWAY_ORIGIN'] ?? 'wss://localhost:8788',
    search: new CatalogSearch(async () => {
      // The real search.list call lands with the YouTube client; until then this
      // refuses rather than returning a plausible empty list, which would read
      // as "nothing matched" (IMMUNE-U).
      throw new Error('catalog fetcher not configured');
    }, quota),
    fetchVideoDetails: async () => {
      throw new Error('video details fetcher not configured');
    },
    agentAvailable: () => (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '',
  };
}

/**
 * Built ONCE per server, not per request. Found at Gate C: constructing these
 * per request gave every call a fresh SearchQuota, so the daily counter never
 * accumulated and the cache and in-flight deduplication could never serve a
 * second caller — the whole point of holding the allowance server-side.
 */
const deps = createDeps();

export const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'GET' && req.url === '/health') {
      await writeReply(res, { status: 200, body: { ok: true } });
      return;
    }
    const reply = await handle(req.method ?? 'GET', requestUrl(req), deps);
    await writeReply(
      res,
      reply ?? {
        status: 404,
        body: { ok: false, reason: 'not_implemented', detail: `No route for ${req.method} ${req.url}` },
      },
    );
  })().catch(async (cause: unknown) => {
    // Found at Gate C by reproducing it: a rejected handler in this detached
    // async function was an unhandled rejection, and one valid catalog request
    // terminated the process with no response at all. A failure must surface as
    // a typed reply, never as a dead server (IMMUNE-U).
    process.stderr.write(`[backend] request failed: ${String(cause)}\n`);
    try {
      await writeReply(res, {
        status: 500,
        body: { ok: false, reason: 'internal_failure', detail: String(cause) },
      });
    } catch {
      res.destroy();
    }
  });
});

// Only listen when run directly, so tests can import the server without
// binding a port.
if (process.argv[1]?.endsWith('index.ts') === true || process.argv[1]?.endsWith('index.js') === true) {
  server.listen(PORT, () => {
    process.stdout.write(`backend listening on http://localhost:${PORT}\n`);
  });
}
