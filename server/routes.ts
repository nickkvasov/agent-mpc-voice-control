import type { IncomingMessage, ServerResponse } from 'node:http';
import { mintTicket } from './ticket/route.ts';
import { CatalogSearch, type SearchCriteria } from './catalog-proxy/search.ts';
import { parseIso8601Duration, UNKNOWN, type VideoDetails } from './catalog-proxy/videos.ts';

/**
 * The HTTP surface. Found missing at Phase 2's Gate C: the modules existed and
 * `index.ts` imported none of them, so every endpoint answered 404 while the
 * tasks were marked complete.
 */
export interface RouteDeps {
  readonly gatewayOrigin: string;
  readonly search: CatalogSearch;
  readonly fetchVideoDetails: (ids: readonly string[]) => Promise<readonly VideoDetails[]>;
  /** Absent when the agent host has no credential — reported, not faked. */
  readonly agentAvailable: () => boolean;
}

export interface RouteReply {
  readonly status: number;
  readonly body: unknown;
}

export async function handle(method: string, url: URL, deps: RouteDeps): Promise<RouteReply | undefined> {
  if (method === 'POST' && url.pathname === '/api/mcp-ticket') {
    if (!deps.agentAvailable()) {
      // A normal condition, not an exception path: the page must stay fully
      // usable by hand and show the assistant as unavailable (FR-037, SC-010).
      return { status: 503, body: { ok: false, reason: 'agent_unavailable', detail: 'The agent host has no credential configured.' } };
    }
    return { status: 200, body: mintTicket(deps.gatewayOrigin) };
  }

  if (method === 'GET' && url.pathname === '/api/catalog/search') {
    const query = url.searchParams.get('q');
    if (query === null || query.trim() === '') {
      return { status: 400, body: { ok: false, reason: 'missing_query', detail: 'q is required.' } };
    }
    const criteria: SearchCriteria = {
      query,
      ...optionalTime('publishedAfter', url),
      ...optionalTime('publishedBefore', url),
    };
    const outcome = await deps.search.search(criteria);
    if (!outcome.ok) {
      return {
        status: 429,
        body: { ok: false, reason: outcome.reason, detail: outcome.detail, resetsAt: outcome.quota.resetsAt },
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        results: outcome.results,
        criteriaApplied: outcome.criteriaApplied,
        fromCache: outcome.fromCache,
        quota: outcome.quota,
      },
    };
  }

  if (method === 'GET' && url.pathname === '/api/catalog/videos') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (ids.length === 0) {
      return { status: 400, body: { ok: false, reason: 'missing_ids', detail: 'ids is required.' } };
    }
    return { status: 200, body: { ok: true, videos: await deps.fetchVideoDetails(ids) } };
  }

  return undefined;
}

function optionalTime(name: string, url: URL): Record<string, number> {
  const raw = url.searchParams.get(name);
  if (raw === null) return {};
  const n = Number(raw);
  return Number.isFinite(n) ? { [name]: n } : {};
}

/** Re-exported so the duration parser has one owner and one test surface. */
export { parseIso8601Duration, UNKNOWN };

export async function writeReply(res: ServerResponse, reply: RouteReply): Promise<void> {
  res.writeHead(reply.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(reply.body));
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}
