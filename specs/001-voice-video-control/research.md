# Phase 0 Research: Agentic Voice and Text Control of a Video Library

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

Four unknowns in the Technical Context were load-bearing enough to block design. Two of them came
back with answers that change what the feature can promise, and both are recorded here rather than
discovered during implementation.

---

## R1. On-device speech recognition — the default browser API would violate FR-043

**Decision**: Use the Web Speech API with `processLocally = true`, gated at startup by
`SpeechRecognition.available({ processLocally: true })`. If on-device recognition is unavailable,
voice input is **refused with a stated reason** and the person uses text. Never fall back to the
default recognition mode.

**Rationale**: `processLocally` defaults to `false`, and in that mode the specification permits the
user agent to process audio **remotely at its discretion**. Chrome has historically done exactly
that. A default-mode implementation would therefore ship audio off the device while the interface
claimed otherwise — violating FR-043 and making SC-013 untestable-but-false, which is precisely the
silent success IMMUNE-U forbids. The feature is marked experimental, so availability must be probed
at runtime and never assumed.

**Alternatives considered**:
- *Default Web Speech API.* Rejected: silently violates FR-043. This is the option that looks like it
  works, which is what makes it dangerous.
- *Whisper in-browser via WebGPU (transformers.js).* Genuinely local and browser-independent, at the
  cost of a large first-run model download and materially worse latency against SC-001's one-second
  budget. Recorded as the fallback if `processLocally` support proves too narrow in practice.
- *Server-side recognition.* Rejected outright — contradicts FR-043.

**Consequence for the plan**: voice is a *conditional* capability. The startup probe and its refusal
path are first-class work, not error handling bolted on later.

### R1 — MEASURED 2026-09-12 (T008)

Probed in real browsers via `spikes/t008-recognition-probe.mjs`, against Chrome for Testing
153.0.8010.12 and system Chrome on a secure context.

| Check | Result |
|---|---|
| `SpeechRecognition` / `webkitSpeechRecognition` | both present |
| `processLocally` on the prototype | **yes** |
| `SpeechRecognition.available` / `.install` statics | **both present** |
| `available({langs:['en-US'], processLocally:true})` — headed chromium | **`"downloadable"`** |
| `available(...)` — system Chrome | **`"downloadable"`** |
| `available(...)` — **headless** chromium | **crashes the renderer** |

**Two findings, both consequential.**

1. **On-device recognition is real, but not ready on first run.** `"downloadable"` is a third state
   that is neither available nor unavailable: the language pack must be fetched via
   `SpeechRecognition.install()` before voice can work. The plan assumed a binary probe. It is
   ternary — `unavailable` / `downloadable` / `available` — and the interface must be able to say
   "voice is preparing" rather than silently refusing or silently waiting. This is Constitution IV
   (unknown is a value) appearing in a place the design did not anticipate.

2. **The probe crashes headless Chrome.** Not a rejected promise — the renderer dies. Any e2e test
   touching voice must run headed, and the startup probe must survive a crashed call rather than
   assume it returns. A refusal path that itself takes down the tab is not a refusal path.

**Whisper/WebGPU fallback**: not needed for capability reasons — the API is genuinely present. It
remains the answer only if the install download proves unacceptable in practice.

**Not yet measured**: what `install()` actually costs (download size and time). Deliberately not run
here — this machine's network could not reach the npm registry for 25 minutes today, so a large
download would have measured the network rather than the feature.

---

## R2. YouTube search quota — 100 calls per day, for the whole application

**Decision**: Route all catalog access through a backend proxy that holds the API key, caches search
results and video metadata aggressively, and exposes remaining quota to the page so FR-022 can report
it. Treat client-side narrowing (FR-016) as the primary quota-preservation mechanism.

**Rationale**: `search.list` is capped at **100 calls per day per project**, separate from the 10,000
units/day pooled across other endpoints (`videos.list`, `playlistItems.list` cost 1 unit each and are
effectively unconstrained by comparison). Because the feature is anonymous (FR-042), that ceiling is
shared by every person using the deployment — not 100 searches each, 100 searches total. A
conversational interface invites rapid reformulation ("no, the shorter ones", "try last month
instead"), so a naive implementation that issues a fresh search per utterance exhausts a day's quota
in a single sitting.

This reframes two existing requirements:
- **FR-016** ("apply successive narrowing to the current result set") stops being a UX nicety and
  becomes the mechanism that keeps the feature usable. Narrowing must be done locally over already
  fetched results wherever the criteria allow it.
- **FR-022** (report quota exhaustion, keep loaded results and playback usable) describes an ordinary
  daily condition, not a rare failure. It needs real design, not a toast.

**Alternatives considered**:
- *Call the Data API directly from the browser.* Rejected: exposes the key, and makes central caching
  and quota accounting impossible.
- *Request a quota increase.* A deployment-time action, not an architectural one; the design must
  work at the default allocation regardless.
- *Scrape or use an unofficial endpoint.* Rejected: violates YouTube's terms, which the spec names as
  a governing dependency.

---

## R3. Meeting SC-001's one-second budget with an off-device agent

**Decision**: Two paths to the same tools. A **local deterministic matcher** handles a closed set of
playback commands (play, pause, resume, stop, seek absolute/relative, speed, volume, mute, captions
on/off, next, previous) and calls the page's declared tools directly. Everything else — discovery,
queueing, curation, anything ambiguous — goes to the Claude agent. The matcher never guesses: an
utterance it does not match with high confidence falls through to the agent rather than picking a
nearest command.

**Rationale**: SC-001 requires a visible result within one second of the person finishing speaking,
*including* recognition and round-trip. A remote LLM turn cannot reliably meet that, and "pause"
taking two seconds is the difference between a control and a request. The closed playback vocabulary
is small, finite and unambiguous — exactly the case where a matcher is appropriate and an LLM is
overkill. SC-012's three-second budget is comfortable for the agent path.

**Alternatives considered**:
- *Everything through the agent.* Rejected: fails SC-001 for the most common commands.
- *Everything through the matcher.* Impossible — discovery and curation are open-ended.
- *Speculative execution (run both, take the faster).* Rejected under Proportionate Engineering: it
  doubles cost and introduces a class of conflict the activity record would have to explain.

**Constitutional note**: two interpreters of one utterance risks duplicating authority (IMMUNE-N).
It is contained by giving them nothing to disagree about: the **tools are the single owner** of what
an action does, both paths call the same tools, both write to the same activity record, and neither
path may interpret an utterance the other has already accepted. Recorded in Complexity Tracking.

---

## R4. Player capability surface — captions are the weak point

**Decision**: Build playback control on the YouTube IFrame Player API. Map error codes to the
specific reasons FR-036 requires: `100` → removed or not found, `101`/`150` → embedding disallowed by
the owner, `2` → invalid request, `5` → player failure. Wire `onAutoplayBlocked` to the
autoplay-refusal path and `onError`/`onStateChange` to the activity record.

**Rationale**: The IFrame API covers almost everything the spec requires directly —
`playVideo`/`pauseVideo`/`stopVideo`, `seekTo`, `setPlaybackRate` with `getAvailablePlaybackRates`
(so FR-008 can state the rate it actually got rather than the one requested),
`setVolume`/`mute`/`unMute`/`isMuted`, and a state model that maps cleanly onto the player controls
FR-013 must keep in sync.

**Two gaps found, both already covered by spec requirements**:
- **Captions (FR-010) are barely documented.** The public reference documents only
  `setOption('captions', 'fontSize', …)` and `setOption('captions', 'reload', …)`. Enabling a track
  and enumerating available tracks are not part of the documented surface. FR-010's acceptance
  scenario 5 — say so when no captions exist — is therefore the *likely* path, not the exception.
  **This is the single biggest implementation risk in the feature and needs a spike before its
  tasks are estimated.**
- **Volume is not guaranteed.** Mobile browsers commonly ignore programmatic volume, which is exactly
  why FR-009 requires reporting platform refusal rather than reporting success. Implementation must
  verify via `getVolume()`/`isMuted()` after setting, and report the discrepancy.

**Alternatives considered**: a custom HTML5 player over raw streams — rejected, it violates YouTube's
terms, which the spec names as a governing dependency.

### R4 — MEASURED 2026-09-12 (T007)

Probed against a real YouTube player via `spikes/t007-captions.mjs`, served over http (a `file://`
origin returns player error **153, missing HTTP Referer** — the IFrame API requires a real origin,
which is itself worth knowing before someone debugs it as a caption problem).

| Operation | Result |
|---|---|
| `loadModule('captions')` | works |
| `getOption('captions','tracklist')` | **returns the full track list** — `languageCode`, `languageName`, `displayName`, `is_translateable`, `vss_id` |
| `getOption('captions','track')` | returns the active track |
| `setOption('captions','track',{languageCode:'en'})` | **works**, and reads back correctly |
| `setOption('captions','track',{})` | readback still reports `en` |
| `unloadModule('captions')` | readback still reports `en` |

**The risk is half resolved, and the remaining half is the opposite of what was expected.**

- **Enabling, enumerating and selecting a caption track all work**, despite being absent from the
  public reference. FR-010's main clause is achievable, and R4's "single biggest implementation risk"
  is retired. The acceptance scenario about saying captions are unavailable becomes the exception
  again rather than the likely path.
- **Turning captions off is not verifiable through the same readback.** Neither candidate produced an
  observable change. It may be that `getOption('captions','track')` reports the *selected* track
  rather than whether captions are *rendered*, in which case captions may genuinely be off while the
  readback is simply the wrong observable — and the rendered caption DOM is inside a cross-origin
  iframe, so it cannot be inspected to settle it.

**Consequence for FR-010 and for T037.** `playback.setCaptions({enabled:true, track})` can report
success honestly because it reads back. `{enabled:false}` cannot, and under Constitution III a call
that cannot verify its effect must not claim one. Until a reliable observable is found, the disable
path must return a result that states the uncertainty rather than a bare success.

**Standing risk**: this surface is undocumented, so it can change without notice. The readback in
T032 is what would catch that, rather than a silent regression to captions that never turn on.

---

## R5. Agent runtime and model

**Decision**: The agent loop runs server-side against the Claude API using the official Anthropic
SDK, on `claude-opus-5` with adaptive thinking and streaming. The browser never holds an API key.

**Rationale**: The spec names the Claude API as the driving service. `agent-mcp-react` supplies only
the in-page half: the page asks the backend for a connection URL, connects out, and the MCP client
lives with the agent. Streaming matters because the agent's progress is what the person watches
during the three-second window of SC-012. Credentials stay server-side by construction, which is also
what makes the single-use ticket in the gateway contract necessary.

**Alternatives considered**: browser-side agent calls — rejected, it would expose the key; and the
foundation's own design expects the page to connect outward to a gateway.

---

## Revision 2026-09-13 — after live verification and the second clarification session

Live runs with real credentials showed the page had no YouTube player and no path from an utterance to
the assistant, and the clarification session of 2026-09-13 changed SC-001, SC-012 and FR-038 and added
FR-046. R6–R10 are the research those changes needed. Where they overturn an earlier entry, the earlier
entry is marked rather than rewritten, so the reasoning that led to it stays readable.

**Superseded in part:** R3's premise that the one-second budget is unreachable through a remote model
still holds, but its consequence changed — SC-001 no longer asks the assistant path to meet it (R9).
R5's "streaming matters during the three-second window of SC-012" now reads ten seconds.

---

## R6. The gateway — how an agent reaches the page

**Decision**: The backend process hosts the gateway beside its HTTP routes: a `ws` `WebSocketServer`
in `noServer` mode on the same HTTP server, upgrading only `/mcp`, and refusing an unredeemable ticket
**at the upgrade** with HTTP 401 so the page never sees `open`. Each accepted socket gets an MCP
`Client` from `@modelcontextprotocol/client` 2.x over a small `Transport` adapter — one JSON-RPC
message per text frame, frames read with the SDK's own `deserializeMessage`, `onclose` fired exactly
once however the socket ended. The tool listing is cached per connection and invalidated by the page's
`notifications/tools/list_changed`, replacing the loop's current re-list on every iteration.

**Rationale**: `agent-mcp-react` is only the browser half; its README names the gateway, the ticket
minter and the agent runtime as the application's to supply. Its reference implementation
(`tools/mock-agent` in the library repository — `gateway.ts`, `client.ts`, `chat.ts`) was read for this
entry, and every rule above comes from it, each with a failure behind it:

- *Refuse at the upgrade.* Accepting and then closing gives the page an `open` event, and anything sent
  in that window reached an unauthenticated peer.
- *The page is the server.* Browser JavaScript cannot accept connections, so the client answers on a
  socket it did not open. `client.connect()` must be what calls `start()`, or early frames are dropped
  silently.
- *Validate frames, never cast them.* A frame that is valid JSON but not JSON-RPC is reported and
  dropped, not trusted — Constitution III at the socket.
- *List on change, not on a guess.* The page announces tool changes (FR-035); re-listing every round
  trip is a workaround for ignoring that signal, and costs a socket round trip per iteration against
  SC-012's budget.

The ticket minter already exists (`server/ticket/route.ts`, single-use, 30s) and is kept. Its
`gatewayOrigin` default of `wss://localhost:8788` names a server that does not exist and becomes the
backend's own origin, `ws://localhost:8787` in development — `localhost` is a secure context, so `ws:`
is permitted there.

**Also found**: the reference translates tool names against `^[a-zA-Z0-9_-]{1,64}$`, while
`server/agent/tool-names.ts` states a limit of 128. This project's longest name is 29 characters, so
neither bound is reached today; the alias map must still refuse a name over the stricter bound rather
than let the API reject the whole request. Verify the exact figure against the API reference when the
task lands rather than trusting either copy.

**Alternatives considered**:
- *A separate gateway process.* Rejected: the turn endpoint must reach the socket for a specific page,
  and a second process would need its own channel to the first to do it.
- *Server-Sent Events plus POST in place of a WebSocket.* Rejected: the library dials a WebSocket and
  treats the URL as opaque; a different transport means forking the browser half.
- *Handling the upgrade by hand.* Rejected: `ws` is what the reference uses and the upgrade path is
  where the security property lives.

---

## R7. Order within a domain, and the assistant overtaken

**Decision**: An **issue fence** in the page, one mechanism for every caller.

- Every command gets an immutable `commandId` and a monotonic `issueSeq` **when issued** — at release of
  the talk control, before recognition finishes, not when its text arrives.
- Every tool declares the **set** of domains it affects (`playback`, `queue`, `catalog_curation`);
  `playback.next` and `playback.previous` declare `playback` and `queue`. Each domain holds
  `lastAppliedIssueSeq`.
- An action applies only if its command's `issueSeq` is not below the fence of **every** domain it
  affects; applying raises those fences. Otherwise it is refused `overtaken_by_newer_command`, naming the
  newer command: *"Did not seek: your later pause already applied. Ask again if you still want it."*
- **The check is made at the moment of application, not at handler entry**, and the check, the effect
  and raising the fence are indivisible against other effects in the same domains. A handler may
  prepare asynchronously (a search, a confirmation, a player readback), but must re-check before it
  applies. A refusal or failure does not raise the fence; a partial effect raises it for what applied.
- A cancelled command is revoked locally **before** remote cancellation is sent, so a late call from it
  is refused whatever the fence says. Equal `issueSeq` is allowed — one command may make several calls —
  and a retry keeps its command's `issueSeq`; it cannot refresh its place.

**Attribution of assistant calls** — the problem that made this a consult: `agent-mcp-react` 0.3.0 gives
a handler `(input, { signal, afterRender })` and nothing else, so an arriving `tools/call` does not say
which command it serves. Decision: **concurrent turns with an injected `commandId`**. Every tool's input
schema carries one reserved field, `commandId`, defined once and added mechanically. The backend loop
removes exactly that field from the schema it shows the model and writes the turn's bound `commandId`
into every call it forwards — overwriting anything the model sent, so the model can neither choose nor
forge it. The page resolves the id to its own command record; unknown, cancelled, finished or foreign
ids are refused. Local callers (clicks, the matcher) receive their id from the same command owner and
enter the same guarded path. Only the id crosses the wire; `issueSeq` never does, so the page remains the
single owner of what the id means.

**Rationale** — decided by failure scenarios, from the codex consult recorded in NOTES.md:

| Option | What breaks it |
|---|---|
| One assistant turn at a time, others wait | A playback turn that never finishes holds an unrelated discovery turn indefinitely — the cross-domain wait FR-038 now forbids |
| One turn at a time, others refused | A blanket availability rule with no ordering conflict behind it: product policy the spec did not ask for |
| Stamp calls with the oldest running turn's sequence | **Unsafe, not merely cautious.** Turn 11's playback action applies stamped 10; a genuinely stale action from turn 10 is also 10 and passes the equality check — the stale overwrite the fence exists to stop |
| A tool per turn | Attribution becomes naming and registration lifecycle — aliases, listing churn, stale cached names — more machinery than one field |
| Fence on the backend | Cannot atomically see a local click racing a browser mutation; the last check must sit beside the state change |

A library change passing MCP request `_meta` to handlers would be the cleaner seam, and the protocol
already supports it. It is not available in 0.3.0, and this plan does not depend on it.

**IMMUNE-N / M1**: two schema representations derived mechanically from one declaration are one
authority with two projections; two maintained by hand would be the violation. The derivation, not
review, is what keeps them equal — and it is tested.

**Alternatives considered**: see the table. The prior global `CommandChain` is retired: it met the old
FR-038 by making every command wait for every earlier one, which is what produced the 5-second pause
behind a stalled search.

**Must be tested against** (from the consult, each as its own case, each break-it proved):
concurrent turns calling the same tool with identical arguments in reversed completion order; older
work overtaken by a newer click, matcher command and assistant command; a stalled playback turn not
delaying discovery and a stalled search not delaying pause; suspension before mutation, during
confirmation and during player readback, then resumption after newer work; cancellation before
dispatch, during preparation and after a partial effect, with late calls delivered after cancellation,
completion, disconnect and reconnect; derived schemas equal in every business constraint, a missing or
forged `commandId` refused; one activity entry per invocation throughout; allowance consumed atomically
by concurrent turn starts. The real WebSocket path is part of these, not only an in-process transport.

---

## R8. Bounding assistant spend in an anonymous deployment (FR-046)

**Decision**: An `AssistantAllowance` on the backend, the same shape as `SearchBudget`: a per-session
limit and a deployment-wide daily limit, both checked **before** a turn starts, the day rolling over
at the same Pacific midnight the search budget uses. Defaults, configurable by environment:
**40 turns per session, 400 turns per day**. A session is an opaque id in an `HttpOnly`,
`SameSite=Strict` cookie set by `POST /api/mcp-ticket`; the ticket records that session, so the socket
it admits is bound to it, and `POST /api/assistant/turns` reaches only the socket of the session whose
cookie it carries.

**Rationale**: FR-042 keeps access anonymous, so the limit cannot be per account. Binding the socket to
a session through the ticket — rather than through a tab id the page reports — follows the library's
rule that a tab identifier is metadata and never a credential: otherwise any page could post a turn
and drive someone else's tab. The per-session limit is not a security boundary (clearing cookies
resets it); the daily limit is the real bound on spend, and the per-session limit keeps one sitting
from consuming everyone's day, the same reason the search budget paces rather than only counts.

Every turn is already bounded at eight model iterations (`MAX_ITERATIONS`), so a turn cap is a spend
cap with a known ceiling. The defaults are a starting point sized against the search budget — at most
two catalog searches per assistant turn in practice, so 400 turns cannot outrun 90 searches by more
than the search budget itself refuses.

**Known limitation, carried over deliberately**: like `SearchBudget`, the counts live in memory and
reset when the process restarts; `searchCallsRemaining` is `null` until established for the same
reason. Persisting either is out of scope for this revision and is stated rather than implied.

**Alternatives considered**: a token budget instead of a turn count (more exact, but the person cannot
reason about "tokens left"); an access code (rejected at clarification); no per-session limit
(one enthusiastic sitting empties the day — the lesson the search budget already paid for).

---

## R9. The assistant path's latency, and what the person sees while it runs

**Decision**: Keep `claude-opus-5` with adaptive thinking and streaming. The page shows the
**acknowledgement itself, immediately and locally**, the moment the matcher falls through — before any
network call — which is how SC-001's and SC-012's one-second acknowledgement is met independently of
the model. The turn streams to the page as Server-Sent Events from `POST /api/assistant/turns`:
`acknowledged`, `tool_call`, `tool_result`, `message`, `refused`, `done`, with `done` always last.
After ten seconds without `done` the page marks the turn **late** (SC-012) and keeps it cancellable;
cancelling aborts the request, which aborts the model stream and sends MCP cancellation to the page, so
a handler already running sees its `signal` abort (FR-004).

**Rationale**: two live turns measured 4.5s and 6.2s end to end with no catalog call. SC-012's ten
seconds leaves room for a search (0.87s measured) and a second iteration; a multi-step request —
"queue the three shortest talks about X" — is where the budget is at risk. The levers, in the order
to pull them if SC-012's live timing test fails: (1) prompt for one precise call and parallel tool use
in one iteration, (2) the cached tool listing from R6, which removes a round trip per iteration,
(3) lower reasoning effort on this path. Changing model is the last lever, not the first — the clarify
session chose a ten-second budget precisely so this path would not be forced onto a weaker model.

**Measured live (T140, 2026-09-14, `claude-opus-5`, adaptive thinking, from end of typed input).**
Acknowledgement is local and was 36–47 ms on every turn; SC-001's recognised path applied `pause` in
55–57 ms. SC-012 **failed** on the first run: "find talks about regular expressions" finished at
14.4 s. A step-by-step trace of a second discovery turn put the time here — 2.5 s for the model to
decide on the search, 1.4 s for the search, and **9.7 s writing a summary of all 25 results**, which
the person could already see on the page. The cost was output, not tools or network.

Lever (1) was pulled: the system prompt now asks for the fewest precise calls, independent calls in
parallel in one step, and a reply of one or two short sentences that does not list or summarise what
is already on screen. Lever (2) was already in place (Phase 11). Lever (3) was not needed.

| Turn | Before lever 1 | After (run 1) | After (run 2) |
|---|---|---|---|
| SC-012 discovery — "find talks about regular expressions" | 14.4 s ✗ | 6.4 s | 6.4 s |
| SC-012 queueing — "queue the first two of those results" | 7.4 s | 6.9 s | 7.4 s |
| SC-001 assistant playback — "go back a bit" (acknowledged; no result budget) | 7.9 s | 6.4 s | 5.9 s |

Two runs is evidence, not a distribution: a request needing several searches, or a long answer the
person asked for, can still exceed ten seconds, and is then shown as *late* rather than hidden. The
timing test (`tests/e2e-live/timing.live.spec.ts`) runs with the live gate, so a regression here is
seen at the next live run.

A single *late* rule (ten seconds, any domain) is used rather than tracking which success criterion a
turn falls under, because the page cannot know a turn's domain until the assistant acts. For playback
this is additional information, not a deadline: SC-001 sets none for this path, and saying "this is
taking longer than usual" contradicts nothing.

**Alternatives considered**: a smaller model by default (rejected at clarification, see above); an
acknowledgement sent by the server (rejected — it would put the one-second promise behind a network
round trip, the exact dependency the split was made to remove); a WebSocket for the turn stream
(rejected — the MCP socket is the page's *server* channel, and multiplexing chat onto it would make the
page's MCP server carry non-MCP traffic).

---

## R10. The real YouTube player, and testing it without trusting a stand-in

**Decision**: Load the IFrame Player API once (`https://www.youtube.com/iframe_api`), create one
`YT.Player` with `playerVars: { origin: location.origin, playsinline: 1 }`, and adapt it to the existing
`YouTubePlayer` interface. Every mutating playback tool **awaits the player's own confirmation** — the
`onStateChange` event for transport, the readback for rate and volume — bounded at one second
(FR-013), and reports `refused_by_player` or the state actually reached when it does not arrive.
`onError` maps to availability (codes 100/101/150), with 153 reported as an origin fault, never as a
property of the video. `onAutoplayBlocked` is a stated outcome: "the browser blocked playback; press
play." `createLocalPlayer` leaves `App.tsx` and survives only as a test double under `tests/`.

**Rationale**: the stand-in answered every call synchronously, so readback always "succeeded". A real
player answers asynchronously — `playVideo()` returns before playback starts, and may never start if
autoplay is blocked — so a tool that reads state immediately after the call reports the *previous*
state as the result. That is the silent success Constitution III names, arriving through timing rather
than through code anyone wrote. It is also why `context.afterRender()` is not enough on its own: it
waits for React, not for the player.

**Testing**: two layers, because the incident that produced this entry was a double nobody checked
against the real thing.
- *Deterministic*: Playwright intercepts `iframe_api` and serves a fake that implements the
  `YouTubePlayer` subset and fires events on a schedule the test controls — including autoplay blocked,
  a state change that never arrives, and each error code.
- *Live*: a separate `test:e2e:live` suite drives the real embed against a known public video: play,
  pause, seek, rate readback, one caption track. It runs at Gate B and at the final gate, needs network,
  and does not run per phase. The fake is only trusted for what the live suite has also observed.

R4's measured results (captions enable/enumerate/select work; disable is unverifiable; 153 needs a real
origin) carry forward unchanged.

**Alternatives considered**: `react-youtube` or a similar wrapper (rejected — it hides the event timing
this entry is about, and adds a dependency to wrap three calls); testing only against the fake (rejected
— that is the incident).

---

## Resolved Technical Context

| Unknown | Resolution |
|---|---|
| Speech recognition location | Web Speech API with `processLocally: true`; **measured** — present but `"downloadable"`, probe crashes headless (R1/T008) |
| Catalog access & quota | Backend proxy, aggressive caching, local narrowing; 100 searches/day app-wide (R2) |
| Meeting the 1s budget | Local matcher for closed playback vocabulary; agent for everything else (R3) |
| Player control surface | IFrame Player API; captions **measured** — enable/enumerate/select work, disable unverifiable (R4/T007) |
| Agent runtime | Server-side Claude API (`claude-opus-5`), streaming, key never in browser (R5) |
| Gateway and MCP client | `ws` upgrade refused before handshake; `@modelcontextprotocol/client` 2.x over a frame adapter; listing cached, invalidated on `list_changed` (R6) |
| Ordering within a domain | Issue fence checked at application; assistant calls attributed by an injected `commandId` the model cannot see or set (R7) |
| Assistant spend | Per-session 40 / daily 400 turns, session bound through the ticket, checked before a turn (R8) |
| Assistant latency | Local acknowledgement; SSE turn stream; late at 10s; cancellation reaches the page's handler (R9) |
| Real player | IFrame API adapter awaiting the player's own confirmation; fake for determinism, live suite for truth (R10) |

**No `NEEDS CLARIFICATION` markers remain.**
