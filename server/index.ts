import { createServer } from 'node:http';
import { CatalogSearch } from './catalog-proxy/search.ts';
import { SearchBudget } from './catalog-proxy/budget.ts';
import { youTubeDurationFiller, youTubeSearchFetcher, youTubeVideoDetailsFetcher } from './catalog-proxy/youtube.ts';
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

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export function createDeps(): RouteDeps {
  const budget = new SearchBudget();
  const youtubeKey = (process.env['YOUTUBE_API_KEY'] ?? '').trim();
  const unconfigured = async (): Promise<never> => {
    // Refuses rather than returning a plausible empty list, which would read
    // as "nothing matched" (IMMUNE-U).
    throw new Error('YOUTUBE_API_KEY is not set on the backend');
  };
  return {
    // The gateway lives in this process (R6), so by default the page dials this
    // server. The old default named wss://localhost:8788 — a server that never
    // existed. `ws:` is permitted because localhost is a secure context.
    // Blank counts as unset: `.env.example` lists the key empty, and `??` alone
    // would turn a copied example into a ticket URL with no origin at all.
    gatewayOrigin: nonBlank(process.env['GATEWAY_ORIGIN']) ?? `ws://localhost:${String(PORT)}`,
    search: youtubeKey === ''
      ? new CatalogSearch(unconfigured, budget)
      : new CatalogSearch(youTubeSearchFetcher(youtubeKey), budget, youTubeDurationFiller(youtubeKey)),
    fetchVideoDetails: youtubeKey === '' ? unconfigured : youTubeVideoDetailsFetcher(youtubeKey),
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
    // Which credentials are present, never their values.
    const has = (name: string): string => ((process.env[name] ?? '').trim() === '' ? 'missing' : 'set');
    process.stdout.write(
      `backend listening on http://localhost:${String(PORT)} (YOUTUBE_API_KEY ${has('YOUTUBE_API_KEY')}, ANTHROPIC_API_KEY ${has('ANTHROPIC_API_KEY')})\n`,
    );
  });
}
