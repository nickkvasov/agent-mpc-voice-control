import type { IncomingMessage, ServerResponse } from 'node:http';
import { mintTicket } from './ticket/route.ts';
import { newSessionId, sessionCookie, sessionFromCookieHeader } from './ticket/session.ts';
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
  readonly headers?: Readonly<Record<string, string>>;
}

/** What a route may read from the request beyond its URL. */
export interface RouteRequest {
  readonly cookie?: string | undefined;
  /** The parsed JSON body, when the route reads one. */
  readonly body?: unknown;
}

/** A page instance id, as `agent-mcp-react` publishes it. Routing metadata only. */
const TAB_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function handle(method: string, url: URL, deps: RouteDeps, request: RouteRequest = {}): Promise<RouteReply | undefined> {
  if (method === 'POST' && url.pathname === '/api/mcp-ticket') {
    if (!deps.agentAvailable()) {
      // A normal condition, not an exception path: the page must stay fully
      // usable by hand and show the assistant as unavailable (FR-037, SC-010).
      return { status: 503, body: { ok: false, reason: 'agent_unavailable', detail: 'The agent host has no credential configured.' } };
    }
    // Which tab this is for. Two tabs share one session cookie; keying the socket
    // by session alone made them replace each other in a reconnect loop (Phase 11
    // Gate B). Metadata, never a credential: the cookie is what admits.
    const tabId = (request.body as { tabId?: unknown } | undefined)?.tabId;
    if (typeof tabId !== 'string' || !TAB_ID.test(tabId)) {
      return { status: 400, body: { ok: false, reason: 'missing_tab_id', detail: 'A connection ticket names the tab it is for.' } };
    }
    // The ticket binds the socket it admits to this session (R8). A request
    // with no valid session cookie is given one.
    const existing = sessionFromCookieHeader(request.cookie);
    const sessionId = existing ?? newSessionId();
    return {
      status: 200,
      body: mintTicket(deps.gatewayOrigin, sessionId, tabId),
      ...(existing === null ? { headers: { 'set-cookie': sessionCookie(sessionId) } } : {}),
    };
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
  res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
  res.end(JSON.stringify(reply.body));
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}
