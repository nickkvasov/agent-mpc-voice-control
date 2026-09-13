import { createServer } from 'node:http';
import { CatalogSearch } from './catalog-proxy/search.ts';
import { SearchBudget } from './catalog-proxy/budget.ts';
import { youTubeDurationFiller, youTubeSearchFetcher, youTubeVideoDetailsFetcher } from './catalog-proxy/youtube.ts';
import { handle, requestUrl, writeReply, type RouteDeps } from './routes.ts';
import { attachGateway } from './gateway/upgrade.ts';
import { handleTurn, TURNS_PATH } from './assistant/turns.ts';
import { AssistantAllowance } from './assistant/allowance.ts';
import { modelFromEnvironment } from './agent/scripted-client.ts';

/**
 * Backend scaffold. It exists for the three things the browser must not hold:
 * the Anthropic key, the YouTube key, and the shared search quota.
 *
 * Unimplemented paths answer 404 with a typed reason rather than a placeholder
 * 200 — an endpoint that answers before it is implemented is the silent success
 * IMMUNE-U forbids.
 */
const PORT = Number(process.env['PORT'] ?? 8787);

/**
 * Chosen once at startup. Throws — stopping the backend with the reason — when a
 * scripted model is configured beside a real key, or a script cannot be read.
 */
const model = modelFromEnvironment(process.env);
const allowance = new AssistantAllowance(AssistantAllowance.limitsFrom(process.env));

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
    // Available when there is a model to run: a real credential, or an explicitly
    // scripted one for deterministic runs (which refuses to start beside a key).
    agentAvailable: () => model !== null,
  };
}

/** Request bodies here are a few fields; anything larger is not one of ours. */
const MAX_BODY_BYTES = 16 * 1024;

/** A body that is absent, too large or not JSON reads as `undefined`, and the route refuses it by name. */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
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
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    if (req.method === 'POST' && req.url === TURNS_PATH) {
      await handleTurn(req, res, body, { gateway, allowance, model: () => model });
      return;
    }
    const reply = await handle(req.method ?? 'GET', requestUrl(req), deps, { cookie: req.headers.cookie, body });
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

/**
 * The WebSocket gateway lives in this process (R6): a turn endpoint must reach
 * the socket of a specific page, and a second process would need its own channel
 * to the first to do it.
 */
export const gateway = attachGateway(server);

// Only listen when run directly, so tests can import the server without
// binding a port.
if (process.argv[1]?.endsWith('index.ts') === true || process.argv[1]?.endsWith('index.js') === true) {
  server.listen(PORT, () => {
    // Which credentials are present, never their values.
    const has = (name: string): string => ((process.env[name] ?? '').trim() === '' ? 'missing' : 'set');
    process.stdout.write(
      `backend listening on http://localhost:${String(PORT)} (YOUTUBE_API_KEY ${has('YOUTUBE_API_KEY')}, ANTHROPIC_API_KEY ${has('ANTHROPIC_API_KEY')}, model ${(process.env['AMR_SCRIPTED_MODEL'] ?? '').trim() !== '' ? 'SCRIPTED' : model === null ? 'none' : 'live'})\n`,
    );
  });
}
