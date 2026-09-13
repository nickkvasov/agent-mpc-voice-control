# Contract: Backend HTTP surface

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12, revised 2026-09-13

The backend exists for three reasons, each forced by a decision in [research.md](../research.md): the
page must not hold an Anthropic key (R5), it must not hold a YouTube key and cannot pool quota (R2),
and `agent-mcp-react` requires the page to fetch a connection URL it never parses.

## `POST /api/mcp-ticket`

Mints a single-use connection URL for the page's MCP server.

**Request**: `{ "tabId": "…" }` — the page instance id `agent-mcp-react` publishes (`useMcpTabId`). Anonymous
(FR-042). A missing or malformed `tabId` → **400** `missing_tab_id`. The tab id is routing metadata and
never admits anything; the session cookie does.

**Response 200**: `{ "url": "ws://…/mcp?ticket=…" }`, and a `Set-Cookie` for the anonymous session
(`HttpOnly; SameSite=Strict; Path=/api`) if the request carried none. The ticket records that session,
so the socket it admits is bound to it (R8).

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

## `GET /mcp?ticket=…` — WebSocket upgrade (R6)

Where the page's MCP server dials in. The page never parses this URL; it only dials what the ticket
endpoint returned.

- The ticket is redeemed **during the upgrade**. Unknown, expired or replayed → **HTTP 401 and no
  handshake**, so the page's socket never opens. Accepting and then closing is forbidden: frames sent
  in that window would reach an unauthenticated peer.
- After the handshake, the backend is the **MCP client** and the page the server. One JSON-RPC message
  per text frame, no envelope. A frame that is not a JSON-RPC message is reported and dropped.
- The connection is bound to the ticket's session **and tab**. Two tabs of one browser session keep
  separate connections; the same tab reconnecting replaces its own earlier one, which is closed. Keyed by
  session alone, two tabs replaced each other and reconnected in a loop (Phase 11 Gate B).
- `notifications/tools/list_changed` from the page invalidates the backend's cached listing.

## `POST /api/assistant/turns` — run one command through the assistant (R9)

**Request**: `{ "commandId": "…", "tabId": "…", "text": "go back a bit" }`, with the session cookie. The
turn reaches only the connection of that session's named tab. The page's
tools, not this body, carry everything the assistant may act on.

**Response 200**: `text/event-stream`. Events, in order, `done` always last:

| Event | Data | Notes |
|---|---|---|
| `acknowledged` | `{ turnId, allowance }` | The turn was admitted and counted (FR-046) |
| `tool_call` | `{ toolName, input }` | The application's own tool name, never the API alias |
| `tool_result` | `{ toolName, ok, reason?, detail? }` | A refusal is data to the model, not an ended turn |
| `message` | `{ text }` | What the assistant says to the person |
| `refused` | `{ reason, detail }` | The turn could not run or continue. After a failure the detail says nothing was done **only** if no tool was called; otherwise it states how many actions were attempted, since a refused call can still have changed something |
| `done` | `{ stopReason }` | `end_turn`, `iteration_limit` (named, never hidden — the page shows it as stopped, not done), `cancelled`, `failed` |

A `tool_result` for a tool the page no longer declares — its view closed, possibly mid-turn — is
`view_not_open`, naming the view to open (FR-035). The model is also told, in its instructions, which
view provides which tools, so it can name what to open for a tool it cannot see at all.

**Refusals before the stream opens** — a normal condition, never an exception path (FR-037):

| Status | `reason` | When |
|---|---|---|
| 409 | `assistant_unavailable` | No page connection is bound to this session and tab. A tab whose socket is open but whose tools are still being listed is waited for, up to three seconds, first: the page already shows the assistant as available by then (T139) |
| 429 | `assistant_allowance_spent` | Session or daily limit reached; body carries `limit: "session" \| "day"` and `resetsAt` |
| 503 | `agent_unavailable` | No Anthropic credential configured |

**Attribution (R7)**: the turn is bound to `commandId`. Every `tools/call` the backend forwards for this
turn carries that id in the reserved `commandId` argument, written by the backend over anything the
model produced; the schema shown to the model omits the field. Concurrent turns are allowed — each call
is attributed exactly, and the page decides whether it may apply.

**Cancellation (FR-004)**: the page revokes the command locally first, then aborts the request. The backend aborts the model stream and sends
MCP cancellation for any tool call in flight, which aborts that handler's `signal` on the page. A turn
cancelled after it was admitted still counts against the allowance.

The page, not this endpoint, marks a turn **late** at ten seconds (SC-012): lateness is what the
person sees, and the page owns the clock that started at the local acknowledgement.

## Agent session (server-side, not browser-facing)

The agent loop runs here against the Claude API on `claude-opus-5` with adaptive thinking and
streaming, holding the MCP client that connects to the page's tools. The page reaches it two ways only:
the WebSocket it opens with a ticket (the page as MCP server) and the turn endpoint above (the page as
the person's messenger). Neither carries the other's traffic.
