# Contract: Backend HTTP surface

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12

The backend exists for three reasons, each forced by a decision in [research.md](../research.md): the
page must not hold an Anthropic key (R5), it must not hold a YouTube key and cannot pool quota (R2),
and `agent-mcp-react` requires the page to fetch a connection URL it never parses.

## `POST /api/mcp-ticket`

Mints a single-use connection URL for the page's MCP server.

**Request**: `{}` — no body. Anonymous (FR-042).

**Response 200**: `{ "url": "wss://…" }`

The URL is **opaque to the browser**: never parsed, amended or stored, per the foundation's contract.
Single-use and short-lived; a replayed ticket is rejected.

**Response 503**: `{ "reason": "agent_unavailable", "detail": "…" }` — the page must stay fully usable
by hand and show the assistant as unavailable (FR-037, SC-010). This response is a normal condition,
not an exception path.

## `GET /api/catalog/search`

Proxies `search.list`, holding the key and the cache.

**Query**: `q`, `publishedAfter?`, `publishedBefore?`, `maxResults?`

**Response 200**: `{ results[], criteriaApplied, quota: { searchCallsRemaining, resetsAt } }`

**Response 429**: `{ "reason": "quota_exhausted", "resetsAt": "…" }` — expected daily, given 100
calls/day application-wide (R2). The page keeps loaded results, the queue and playback working.

Cache keyed on the normalized query plus date bounds. A cache hit spends no quota and says so, so the
page can distinguish "fresh" from "cached" rather than presenting both as current.

## `GET /api/catalog/videos?ids=…`

Proxies `videos.list` (1 unit, effectively unconstrained). Returns duration, captions availability and
chapters where published — the fields FR-012 and FR-017 need.

`hasCaptions` and `chapters` may come back `unknown`; the contract forbids substituting `false`
(IMMUNE-U, and the three-valued rule in [data-model.md](../data-model.md)).

## Agent session (server-side, not browser-facing)

The agent loop runs here against the Claude API on `claude-opus-5` with adaptive thinking and
streaming, holding the MCP client that connects to the page's tools. No browser-facing endpoint —
the page's only contact with the agent is the WebSocket it opens using the ticket above.
