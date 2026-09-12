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

## Resolved Technical Context

| Unknown | Resolution |
|---|---|
| Speech recognition location | Web Speech API with `processLocally: true`; **measured** — present but `"downloadable"`, probe crashes headless (R1/T008) |
| Catalog access & quota | Backend proxy, aggressive caching, local narrowing; 100 searches/day app-wide (R2) |
| Meeting the 1s budget | Local matcher for closed playback vocabulary; agent for everything else (R3) |
| Player control surface | IFrame Player API; captions **measured** — enable/enumerate/select work, disable unverifiable (R4/T007) |
| Agent runtime | Server-side Claude API (`claude-opus-5`), streaming, key never in browser (R5) |

**No `NEEDS CLARIFICATION` markers remain.**
