---
description: "Task list for 001-voice-video-control"
---

# Tasks: Agentic Voice and Text Control of a Video Library

**Input**: Design documents from `/specs/001-voice-video-control/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included, and mandatory.** Not a default — [quickstart.md](./quickstart.md) defines the
automated coverage layers, and `.specify/memory/constitution.md` requires failure behavior to be
tested first-class and every added gate to be broken to prove it.

**Organization**: Tasks are grouped by user story so each ships as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US4, mapping to the spec's prioritized stories
- Every task names its file path

## Path Conventions

Web application per [plan.md](./plan.md): `src/` (browser), `server/` (backend), `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project skeleton and the gate commands the phase workflow depends on.

- [X] T001 Scaffold Vite + React 19 + TypeScript project (ESM only, Node ≥22) in `package.json`, `vite.config.ts`, `tsconfig.json`
- [X] T002 [P] Configure Vitest for unit and contract tests in `vite.config.ts` (colocated with the Vite config so the include globs have one owner, per IMMUNE-N)
- [X] T003 [P] Configure Playwright against installed chromium in `playwright.config.ts`
- [X] T004 [P] Scaffold backend server (Node ≥22, ESM) in `server/index.ts` and `server/tsconfig.json`
- [X] T005 [P] Add `.env.example` documenting `YOUTUBE_API_KEY` and `ANTHROPIC_API_KEY` as **server-only** variables in `.env.example`
- [X] T006 **Fill the gate commands** — `fast`, `final`, `live` are UNCONFIGURED, so `kaliper:phased-implement` will report every gate NOT RUN until this is done — in `.claude/kaliper/phased-implement/gates.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Everything every story depends on. **No user story can start until this phase completes.**

### Spikes — sequence first, they can invalidate estimates rather than merely delay them

- [X] T007 **Captions spike (R4)**: determine whether the IFrame API can enable a caption track and enumerate tracks at all; record the finding and its consequence for FR-010 in `specs/001-voice-video-control/research.md`
- [X] T008 [P] **On-device recognition spike (R1)**: measure real availability of `SpeechRecognition.available({processLocally:true})` across target browsers; if too narrow, record the Whisper/WebGPU fallback as a work item in `specs/001-voice-video-control/research.md`

### Named vocabularies (Constitution: closed sets are one exported dictionary)

- [X] T009 [P] Define refusal reasons as a single `as const` dictionary with derived type and membership test in `src/vocab/refusal-reasons.ts`
- [X] T010 [P] Define video availability reasons (`removed`/`private`/`age_restricted`/`region_blocked`/`embedding_disallowed`/`unknown`) in `src/vocab/availability.ts`
- [X] T011 [P] Define player states mirroring the IFrame model in `src/vocab/player-states.ts`
- [X] T012 [P] Define tool names as one dictionary, so no tool name is ever a bare string literal, in `src/vocab/tool-names.ts`

### The result contract (Constitution III — no bare success)

- [X] T013 Define the shared tool result type `{ok:true,…} | {ok:false, reason, detail}` in `src/mcp/result.ts`
- [X] T014 Write the **contract-wide** invariant test asserting every registered tool can return a typed failure and none can return success with no effect, in `tests/contract/no-bare-success.test.ts`
- [X] T015 Build the activity-record writer that wraps every tool invocation so exactly one entry is written per call, refusals included, in `src/activity/record-writer.ts`
- [X] T016 Write the invariant test asserting one entry per invocation including refusals (SC-006) in `tests/contract/one-entry-per-invocation.test.ts`

### Persistence

- [X] T017 [P] Implement IndexedDB stores for `videoReferences`, `collections`, `commands`, `activityRecords`, `quotaState` in `src/store/db.ts`
- [X] T018 [P] Implement the `VideoReference` type with the three-valued `hasCaptions`/`chapters` fields and validation rules in `src/store/video-reference.ts`
- [X] T019 [P] Write tests asserting unknown is never collapsed to false for captions, chapters or quota (Constitution IV) in `tests/contract/unknown-is-a-value.test.ts`

### MCP wiring

- [X] T020 Wire `AgentMcpProvider` with Ajv validator, `onUnexpectedState`, and `capabilities` fixing `dom.inspect`/`dom.interact`/`evaluate` to false, in `src/mcp/provider.tsx` — **written but never mounted; completed by T104**
- [X] T021 Write the test asserting DOM and evaluate capabilities are off and cannot be enabled by configuration (Constitution II) in `tests/contract/capabilities-locked.test.ts`
- [X] T022 Implement the confirmation resolver where an unclear response resolves to refusal with **no** assume-yes path, in `src/mcp/confirmation-resolver.ts`

### Backend

- [X] T023 [P] Implement `POST /api/mcp-ticket` minting single-use, short-lived opaque URLs in `server/ticket/route.ts`
- [X] T024 [P] Implement the catalog proxy with result cache and quota accounting over `search.list` in `server/catalog-proxy/search.ts`
- [X] T025 [P] Implement `videos.list` proxy returning duration, captions and chapter availability as three-valued in `server/catalog-proxy/videos.ts`
- [X] T026 Implement the agent host: Claude API agent loop on `claude-opus-5`, adaptive thinking, streaming, holding the MCP client, in `server/agent/loop.ts`
- [X] T027 Write the test asserting no API key is reachable from browser bundles in `tests/contract/no-keys-in-browser.test.ts`

### Carried forward from the Phase 2 Gate C review (2026-09-12)

Codex found five tasks marked complete whose helpers existed but whose stated
deliverable did not. They are un-marked above rather than argued about, and the
missing halves are named here so the next run does not rediscover them:

- **T017** — only in-memory stores exist; no IndexedDB adapter, and the
  `commands` store named in data-model.md is absent from the interface entirely.
- **T023-T025** — the ticket minter, quota accounting, search cache and duration
  parser all exist and are tested, but `server/index.ts` imports none of them, so
  every route still answers 404. The HTTP adapters are the missing piece.
- **T026** — `loop.ts` constructs an SDK client and exports request defaults.
  There is no message stream, no MCP client and no tool-call iteration, so the
  agent host cannot process a command.

All five landed in the follow-up run: the `commands` store and an IndexedDB
adapter that reports non-durability instead of silently falling back to memory;
`server/routes.ts` registered in `index.ts` so every endpoint answers; and an
agent loop that streams, iterates tool calls, marks refusals as errors so the
model cannot read them as success, and names its iteration bound rather than
truncating.

### Gap found while closing these — no task owns the gateway

`contracts/backend-http.md` says the page's only contact with the agent is a
WebSocket it opens with a ticket, and that this project supplies that runtime.
**No task in this plan builds it.** The agent loop takes an injectable
`ToolTransport` so it is complete and testable without one, but nothing yet
carries a tool call from the loop to the browser. This needs its own task before
User Story 1 can be driven end to end by an agent.

**Checkpoint**: Foundation ready — user stories may now proceed.

---

## Phase 3: User Story 1 — Control playback by speaking or typing (P1) 🎯 MVP

**Goal**: A person controls playback entirely by voice or text, with the visible controls agreeing.

**Independent test**: Load one video; issue each playback command by voice and again by text; confirm
the player reaches the requested state and the controls agree. Needs no catalog features.

### Tests for User Story 1

- [X] T028 [P] [US1] Contract tests for each `playback.*` tool: schema rejection and every `ok:false` reason, in `tests/contract/playback-tools.test.ts`
- [X] T029 [P] [US1] Test that voice and text produce identical outcomes for equivalent instructions (FR-001) in `tests/integration/voice-text-parity.test.ts`
- [X] T030 [P] [US1] Playwright timing test measuring SC-001 **from end of speech**, not from interpretation, in `tests/e2e/playback-timing.spec.ts`

### Implementation for User Story 1

- [X] T031 [US1] Implement the IFrame player wrapper with state mapping and `onError`/`onStateChange`/`onAutoplayBlocked` handlers in `src/player/player.ts` — **interface only; completed by T113–T117**
- [X] T032 [US1] Implement **readback verification** — `getPlaybackRate`, `getVolume`, `isMuted` after every set, reporting platform refusal rather than success (FR-008, FR-009) — in `src/player/readback.ts`
- [X] T033 [US1] Implement ad detection gating commands the player refuses during ads (FR-014) in `src/player/ad-gate.ts`
- [X] T034 [P] [US1] Declare `playback.play`/`pause`/`stop` tools in `src/player/tools/transport.ts` — **handlers only, never registered with MCP; completed by T105**
- [X] T035 [P] [US1] Declare `playback.seek` with clamping, returning the position actually reached, in `src/player/tools/seek.ts`
- [X] T036 [P] [US1] Declare `playback.setRate`, `setVolume`, `setMuted` over the readback layer in `src/player/tools/rate-volume.ts`
- [X] T037 [US1] Declare `playback.setCaptions` per the T007 spike finding, treating `capability_unsupported` as an expected outcome, in `src/player/tools/captions.ts`
- [X] T038 [P] [US1] Declare `playback.seekToChapter` returning `capability_unsupported` when no chapters exist in `src/player/tools/chapters.ts`
- [X] T039 [P] [US1] Declare `playback.next`/`previous`/`getState` in `src/player/tools/navigation.ts`
- [X] T040 [US1] Implement the on-device recognition probe and the **refusal path** when unavailable — never fall back to remote recognition — in `src/voice/recognition.ts`
- [X] T041 [US1] Implement the push-to-talk control with a capture indicator visible for exactly the capture window in `src/voice/push-to-talk.tsx`
- [X] T042 [P] [US1] Implement the text command input in `src/app/command-input.tsx`
- [X] T043 [US1] Implement the interpretation display so a misrecognition is visible before or as the system acts (FR-003) in `src/app/interpretation.tsx`
- [X] T044 [US1] Implement the **local deterministic matcher** over the closed playback vocabulary, falling through to the agent rather than guessing (R3), in `src/matcher/playback-matcher.ts`
- [X] T045 [US1] Write the test asserting the matcher never guesses — a low-confidence utterance routes to the agent — in `tests/integration/matcher-fallthrough.test.ts`
- [X] T046 [US1] Implement in-flight command cancellation (FR-004) in `src/app/command-cancel.ts` — **never imported by anything; deleted in Phase 9, replaced by `CommandRegistry.revoke` (T100)**
- [X] T047 [US1] Implement player control UI reflecting command-driven changes within 1s (FR-013) in `src/player/controls.tsx`

### What T030 does and does not establish

The timing test measures the segment from a command being ISSUED to its result
being on screen, and asserts it inside a 400ms slice of SC-001's one second. It
does **not** measure recognition, because on-device recognition cannot be driven
here: the availability probe kills the renderer in headless Chrome (T008), and
nothing can synthesise a real on-device transcript. So the test is a budget
FLOOR — failing it means SC-001 is already lost; passing it does not establish
SC-001.

**Outstanding**: measuring the recognition segment needs a headed harness with a
real microphone. That harness does not exist and has no task. It belongs with the
Polish phase's privacy assertions (T088), which need headed running for the same
reason.

**Checkpoint**: US1 independently testable and demonstrable.

---

## Phase 4: User Story 2 — Find and queue videos conversationally (P2)

**Goal**: A person finds videos by description and builds a queue by conversation.

**Independent test**: With catalog access and no curation features, issue narrowing requests and
confirm the visible result set matches the stated criteria at each step.

### Tests for User Story 2

- [X] T048 [P] [US2] Contract tests for `catalog.*` and `queue.*` tools in `tests/contract/catalog-queue-tools.test.ts`
- [X] T049 [P] [US2] **Test asserting `catalog.narrow` issues no network call** — the quota-preservation property the feature depends on (R2) — in `tests/integration/narrow-spends-no-quota.test.ts`
- [X] T050 [P] [US2] Playwright timing test for SC-012 measured from end of speech in `tests/e2e/discovery-timing.spec.ts`

### Implementation for User Story 2

- [X] T051 [US2] Implement result-set state holding the current results and the criteria applied in `src/catalog/results.ts`
- [X] T052 [US2] Declare `catalog.search` returning `criteriaApplied` and `quotaRemaining`, and `quota_exhausted` when spent, in `src/catalog/tools/search.ts`
- [X] T053 [US2] Declare `catalog.narrow` operating **locally** over the current result set in `src/catalog/tools/narrow.ts`
- [X] T054 [P] [US2] Declare `catalog.resolveReference` returning candidates rather than choosing when ambiguous (FR-018) in `src/catalog/tools/resolve.ts`
- [X] T055 [P] [US2] Declare `catalog.getCurrentResults` and `catalog.getQuota` in `src/catalog/tools/read.ts`
- [X] T056 [US2] Implement quota state display including the `unknown` case in `src/catalog/quota-indicator.tsx`
- [X] T057 [US2] Implement quota-exhausted behavior keeping loaded results, queue and playback usable (FR-022) in `src/catalog/quota-degradation.ts`
- [X] T058 [P] [US2] Implement queue state and persistence in `src/queue/queue.ts`
- [X] T059 [P] [US2] Declare `queue.add`/`remove`/`reorder`/`get` in `src/queue/tools/manage.ts`
- [X] T060 [US2] Declare `queue.clear` with confirmation above the five-item threshold in `src/queue/tools/clear.ts`
- [X] T061 [US2] Implement skipping unavailable queue items while stating the specific reason (FR-036) in `src/queue/skip-unavailable.ts`
- [X] T062 [P] [US2] Implement results and queue UI, made visible whenever the queue changes, in `src/catalog/results-view.tsx` and `src/queue/queue-view.tsx`

### Two things US2 does not yet have, named rather than implied

- **The conversational path is unreachable.** Every catalog and queue tool
  exists and is tested, and the UI drives them by hand, but nothing carries an
  utterance to them: the WebSocket gateway still has no task (recorded at the end
  of Phase 2). "find talks about state machines" still answers *the assistant is
  not connected*. US2's acceptance scenarios are satisfied by the tools and by
  hand; they are not yet satisfied conversationally.
- **The live catalog call is unverified.** There is no YouTube key in this
  environment, so the upstream `search.list` path has never run. Everything from
  the response onward is covered by fixtures; the request itself is not.

**Checkpoint**: US2 independently testable.

---

## Phase 5: User Story 3 — See and undo what the assistant did (P3)

**Goal**: Every assistant action is legible and reversible.

**Independent test**: Issue a sequence of commands; confirm each appears accurately; undo a
**non-most-recent** entry and confirm the prior state returns.

### Tests for User Story 3

- [X] T063 [P] [US3] Test that undo works on a non-most-recent entry (FR-030) in `tests/integration/undo-arbitrary-entry.test.ts`
- [X] T064 [P] [US3] Test that a superseded entry names its superseding entry and **does not offer** undo (FR-044) in `tests/integration/undo-superseded.test.ts`
- [X] T065 [P] [US3] Test that `activity.describeRecent` matches the record exactly (FR-033) in `tests/integration/describe-matches-record.test.ts`

### Implementation for User Story 3

- [X] T066 [US3] Implement inverse computation per tool, with `null` meaning not reversible, in `src/activity/inverses.ts`
- [X] T067 [US3] Implement supersession detection setting `undoState` and `supersededBy` from a named later entry, never inferred, in `src/activity/supersession.ts`
- [X] T068 [US3] Declare `activity.undo` returning `not_reversible`/`superseded` instead of attempting and failing in `src/activity/tools/undo.ts`
- [X] T069 [P] [US3] Declare `activity.list` and `activity.describeRecent` answering **from the record** in `src/activity/tools/read.ts`
- [X] T070 [US3] Implement partial-failure recording — what was applied and what was not, never recorded as success (FR-032) — in `src/activity/partial-failure.ts`
- [X] T071 [US3] Implement the activity record UI in interface vocabulary, hiding undo where unavailable, in `src/activity/record-view.tsx`

**Checkpoint**: US3 independently testable.

---

## Phase 6: User Story 4 — Curate collections by conversation (P4)

**Goal**: A person organizes references by voice, with confirmation before anything is discarded.

**Independent test**: Issue create, label, tag and remove requests; confirm each applies to exactly
the intended references and every discarding request halts for confirmation.

### Tests for User Story 4

- [X] T072 [P] [US4] Contract tests for `curation.*` tools including every confirmation gate in `tests/contract/curation-tools.test.ts`
- [X] T073 [P] [US4] Test that an unclear confirmation response **abandons** the action (FR-028) in `tests/integration/unclear-confirmation-refuses.test.ts`
- [X] T074 [P] [US4] Test that actions above five references state the count and require confirming it (FR-027) in `tests/integration/bulk-threshold.test.ts`

### Implementation for User Story 4

- [X] T075 [P] [US4] Implement collection state with case-insensitive unique names, refusing duplicates rather than merging, in `src/curation/collections.ts`
- [X] T076 [P] [US4] Implement tags and personal labels, keeping person-owned fields separate from cached YouTube fields, in `src/curation/annotations.ts`
- [X] T077 [US4] Declare `curation.createCollection` and `addToCollection` in `src/curation/tools/collections.ts`
- [X] T078 [US4] Declare `curation.removeFromCollection` and `deleteCollection` with `confirmation: 'required'` in `src/curation/tools/discard.ts`
- [X] T079 [P] [US4] Declare `curation.setLabel` asserting `sourceTitleUnchanged` in its result so FR-025 is observable, in `src/curation/tools/label.ts`
- [X] T080 [P] [US4] Declare `curation.addTags`/`removeTags` in `src/curation/tools/tags.ts`
- [X] T081 [US4] Implement collection and tag UI showing which fields are the person's own in `src/curation/curation-view.tsx`

### A known limitation, recorded rather than left to be found

Restoring a removed collection member puts it back at the index it held. Undoing
SEVERAL removals out of their removal order can still misplace them, because
each index was taken against a different array. The queue solved the same
problem with a permanent sort key; collections hold bare video ids and would
need the same treatment. Single removals — the case the interface actually
offers — restore correctly and are tested.

**Checkpoint**: All four stories delivered.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The requirements that are cross-cutting by nature, and the evidence the constitution
requires. **These are not optional cleanup** — Scenario 5 and 6 are where this system's characteristic
failure would hide.

- [X] T082 Implement the disclosure that command text and video titles reach an external language model service (FR-045) in `src/app/privacy-disclosure.tsx`
- [X] T083 Implement assistant-unavailable state keeping the whole interface usable by hand (FR-037) in `src/mcp/connection-status.tsx`
- [X] T084 Implement command ordering — applied in the order issued, or explicitly refused (FR-038) — in `src/app/command-chain.ts` (not `command-queue.ts`: the ordering boundary was extracted during Phase 3's Gate C, when a chain living inside a React callback proved untestable) — **superseded by the per-domain fence in T099–T102 after FR-038 was clarified 2026-09-13**
- [X] T085 Implement the unavailable-view refusal naming the view that owns the capability (FR-035) in `src/mcp/tool-availability.ts`
- [X] T086 [P] Implement clearing of command transcript history (FR-041) in `src/app/history-controls.tsx`
- [X] T087 Playwright **failure matrix** covering quickstart Scenario 5: recognition unavailable, agent disconnected, quota exhausted, video removed/embedding disallowed, ad in progress, view not open — each asserting a stated reason (SC-009) — in `tests/e2e/failure-matrix.spec.ts`
- [X] T088 Playwright **privacy assertions** covering quickstart Scenario 6: no request carries audio (SC-013), capture indicator matches capture window (SC-011), disclosure present (FR-045), in `tests/e2e/privacy.spec.ts`
- [X] T089 **Break-it-to-prove-it pass**: for each confirmation gate, the no-bare-success invariant and the no-audio-egress assertion, delete the check, confirm red, restore, and record it in `.claude/kaliper/phased-implement/NOTES.md`
- [X] T090 Record in `.claude/kaliper/phased-implement/NOTES.md` every incident a green suite missed during live runs

---

## Found after closeout — 2026-09-13, once real credentials existed

Recorded rather than silently re-opened: each of these was reported complete, or
reported as a smaller gap than it is.

- **T031 is not met.** The task names an IFrame player wrapper with
  `onError`/`onStateChange`/`onAutoplayBlocked` handlers. What exists is the
  `YouTubePlayer` interface and the error mapping. No IFrame API is loaded and no
  video is ever embedded: `App.tsx` drives `createLocalPlayer`, an in-memory
  stand-in with a fixed 600s duration, and a result's **Play** answers "Would play
  … once the player embed lands." Every playback Gate B so far drove that
  stand-in. The tools above it are real; nothing a person can watch is.
- **There was no YouTube client, not merely an unverified one.** Both backend
  fetchers threw unconditionally, so a key alone would have changed nothing.
  Now `server/catalog-proxy/youtube.ts`: `search.list` followed by one
  `videos.list` for durations, captions and description chapters kept
  three-valued, upstream `quotaExceeded` mapped to `quota_exhausted` and written
  back into the budget, and no error that can carry the key. Verified live: 25
  results, all with durations; the repeated query served from cache.
- **The page turned every missing duration into 0** (`src/catalog/client.ts`),
  re-introducing the defect the `VideoReference` type had been fixed against.
  Fixtures always carried a duration, so no test could see it.
- **Nothing started the backend.** `npm run dev` is Vite alone, while quickstart
  said "frontend + backend". Added `npm run server` (reads `dev.env` or `.env`).
  `gates.json`'s `live.start` still runs only `npm run dev`.
- **SC-001 is out of reach through the agent.** Two live turns on
  `claude-opus-5` with adaptive thinking took 6.2s ("go back a bit": getState,
  then seek) and 4.5s (a captions refusal, reported correctly). SC-001 allows one
  second including the assistant round-trip. Commands the local matcher handles
  never reach the agent and are unaffected; the fall-through is not. Two
  measurements, not a benchmark — but the gap is sixfold. Needs a decision:
  the budget, the model or effort on that path, or narrowing SC-001 to matched
  commands.
- **The dev server served the credentials.** `GET /dev.env` on :5273 returned
  both keys; `vite.config.ts` now denies `*.env` and `*.env.*`, proved by
  `tests/e2e/credentials-not-served.spec.ts`.
- **FR-038 and SC-001 collide on a slow search** (codex, reproduced at 5000 ms).
  Every command shares one `CommandChain`, so "pause" issued after a stalled
  search waits for it — now at most the 5s upstream deadline, previously
  unbounded. FR-038 permits waiting or an explicit refusal; SC-001 permits
  neither beyond one second. Letting commands that touch disjoint state (playback
  vs catalog) pass each other would satisfy both in spirit and breaks FR-038's
  letter. Undecided — needs a ruling, not a patch.
- **The page publishes no MCP tools at all.** Found while mapping the revision's
  tasks to files: `main.tsx` renders `App` without `AgentMcpProvider`, and nothing
  calls `useMcpTool`. T020 wrote the provider and never mounted it; T034–T039 and
  their siblings wrote handlers that buttons and the matcher call directly. An
  assistant connected today would list an empty page. Principle II's "declared by
  the component that owns the state" is therefore unmet everywhere, and FR-035's
  "not on screen" behaviour has never been exercised through MCP.
- **The gateway still has no task** (unchanged) — now T118–T125. The loop is verified live
  against the real API through an in-process transport; nothing carries a page's
  tools to it.

---

## Phase 8: Setup for the 2026-09-13 revision

**Purpose**: Dependencies, scripts and gates the new work needs. Plan: *Revision 2026-09-13*;
research R6–R10.

- [X] T091 Install `ws` 8.x, `@types/ws` and `@modelcontextprotocol/client` 2.x (the reference gateway's own choices, R6) in `package.json` — if npm times out, run with `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=15000` (NOTES.md)
- [X] T092 Add `npm run dev:all`, starting the backend and Vite as one process group that stops both on exit and on either one failing, in `scripts/dev-all.mjs` and `package.json`; change `live.start` to `npm run dev:all` and add `http://localhost:8787/health` to `live.urls` in `.claude/kaliper/phased-implement/gates.json`
- [X] T093 [P] Add a separate Playwright configuration for `tests/e2e-live/` (excluded from `test:e2e`, needs network and `dev.env`) and a `test:e2e:live` script, in `playwright.live.config.ts` and `package.json` — a separate file rather than a project in `playwright.config.ts`, so the deterministic suite cannot start the backend or read credentials by accident; add it to `final` in `.claude/kaliper/phased-implement/gates.json` with a `why` naming its prerequisites
- [X] T094 [P] Replace the `gatewayOrigin` default `wss://localhost:8788` with the backend's own origin (`ws://localhost:8787` in development) and document `ASSISTANT_TURNS_PER_SESSION` (40) and `ASSISTANT_TURNS_PER_DAY` (400) in `server/index.ts` and `.env.example`

---

## Phase 9: Foundational — publish the tool surface, and order it per domain

**Purpose**: Make the page an MCP server for real, and replace global ordering with the issue fence
(FR-035, FR-038, Principle II, R7). **Blocks every conversational task below.** The consult's race
cases are the tests; each is break-it proved.

### Tests for Phase 9

- [X] T095 [P] Playwright: every tool in `contracts/mcp-tools.md` appears in the page's registry exactly while its owning view is mounted, and disappears when it unmounts (FR-035) — read through the registry, not through the handlers — in `tests/e2e/tool-surface.spec.ts`. Every view was permanently mounted, so FR-035 could never occur; the collections and queue panels gained Hide/Show controls in `src/App.tsx` to make it real
- [X] T096 [P] Contract test: for every tool, the model-facing schema equals the wire schema minus `commandId` in every business constraint; a call missing `commandId`, carrying an unknown one, or carrying a cancelled or finished one is refused, in `tests/contract/command-id-schema.test.ts`
- [X] T097 [P] Integration test of the issue fence per R7: identical concurrent calls from two commands in reversed completion order keep their attribution; older work overtaken by a newer click, matcher command and assistant command is refused `overtaken_by_newer_command` naming the newer command; suspension before mutation, during confirmation and during player readback followed by newer work refuses the older on resume; `playback.next` is fenced by `playback` and `queue`; a refusal does not raise a fence; one activity entry per invocation throughout, in `tests/integration/issue-fence.test.ts`
- [X] T098 [P] Integration test of cancellation and cross-domain independence: cancel before dispatch, during preparation and after a partial effect; late calls after cancellation, completion, disconnect and reconnect are refused and never re-attributed; a stalled search does not delay pause; a stalled playback command does not delay a queue change, in `tests/integration/domain-independence.test.ts`

### Implementation for Phase 9

- [X] T099 Define the `CommandDomain` vocabulary and each tool's declared domain set (`playback.next`/`previous` → `playback` + `queue`; `activity.undo` → the reversed entry's domains; read-only tools → none), refusing a mutating tool with no domains at declaration, in `src/vocab/command-domains.ts`
- [X] T100 Implement the command owner: `commandId`, `issueSeq` assigned at issuance (talk-control release, typed submit, click), outcome, and `revoked` set before any remote cancellation, in `src/app/commands.ts` — and spoken/typed intake in `src/app/command-intake.ts`, extracted so it is testable. `src/app/command-cancel.ts` (T046's FR-004 cancellation) was imported by nothing — it never worked — and is deleted; revocation replaces it
- [X] T101 Implement the issue fence — per-domain `lastAppliedIssueSeq`, a check made at application and indivisible with the effect, partial effects raising only what applied — and add `overtaken_by_newer_command` and `autoplay_blocked` to `src/vocab/refusal-reasons.ts`, in `src/app/issue-fence.ts`
- [X] T102 Route `invokeRecorded` through the command owner and the fence so clicks, the matcher and MCP calls share one path; retire the global `CommandChain` and migrate its ordering tests to the fence, in `src/app/invoke.ts`, `src/App.tsx` and `src/app/command-chain.ts` — the per-tool logic moved out of `App.tsx` callbacks into `src/app/tool-actions.ts`, one function of `(command, input)` per tool. Two duplicate authorities found and removed on the way: `App.tsx` and `mcp/provider.tsx` each built their own activity recorder (now `src/activity/recorder.ts`), and the observer recorded every `result` as success (now only calls whose `invoke` gate did not run, `src/activity/from-observed-call.ts`)
- [X] T103 Define the reserved `commandId` field once, add it to every tool's input schema mechanically, and export the derivation that removes exactly that field for the model, in `src/mcp/command-id.ts` (pure module; the backend imports it rather than restating the field name). **No tool had an input schema at all**: all 32 were written from the contract in `src/mcp/tool-schemas.ts` first
- [X] T104 Mount `McpRoot` around the application with the ticket supplier fetching `POST /api/mcp-ticket`, in `src/main.tsx` and `src/mcp/provider.tsx`
- [X] T105 Register every `playback.*` tool with `useMcpTool` in the component that owns the player, handlers delegating to the existing tool functions through `invokeRecorded`, awaiting `context.afterRender()` after mutations, in `src/player/controls.tsx` through `src/mcp/declared-tools.tsx` (one registration component per tool, resolving `commandId` to the page's command record)
- [X] T106 [P] Register every `catalog.*` tool with `useMcpTool` in the browse view, in `src/catalog/results-view.tsx`
- [X] T107 [P] Register every `queue.*` tool with `useMcpTool` in the queue view, in `src/queue/queue-view.tsx`
- [X] T108 [P] Register every `curation.*` tool, asking the person **inside the handler only**, before the domain is taken, in `src/curation/curation-view.tsx` — not with `confirmation: 'required'`: no resolver was ever given to the provider, so the library would refuse every such call, and its flag gates only its own bridge; declaring both would ask the assistant path twice
- [X] T109 [P] Register every `activity.*` tool with `useMcpTool` in the record view, in `src/activity/record-view.tsx`

**Checkpoint**: an MCP client listing the page sees its tools change as views open and close; ordering
refusals are stated; nothing waits across domains.

---

## Phase 10: User Story 1 — the real YouTube player (Priority: P1)

**Goal**: Replace the in-memory stand-in with the IFrame Player API, reporting only what the player
confirms (R10). Completes T031.

**Independent test**: Load a public video; play, pause, seek, change rate and turn on a caption track
by button and by typed command; each control shows the state the real player reports.

### Tests for User Story 1

- [ ] T110 [P] [US1] Fake IFrame API fixture implementing the `YouTubePlayer` subset, firing events on a schedule the test controls — including a state change that never arrives, autoplay blocked, and errors 100/101/150/153 — served by route interception, in `tests/e2e/fixtures/fake-iframe-api.js`
- [ ] T111 [P] [US1] Playwright against the fake: every Scenario 1 row; a state change that never arrives → `refused_by_player` with the actual state; autoplay blocked → `autoplay_blocked`, never "playing"; 153 reported as an origin fault, not as the video unavailable, in `tests/e2e/player.spec.ts`
- [ ] T112 [P] [US1] Live suite against the real embed on a known public video: play, pause, seek, rate readback, one caption track — the fake is trusted only for what this also observes, in `tests/e2e-live/player.live.spec.ts`

### Implementation for User Story 1

- [ ] T113 [US1] Load the IFrame Player API once, resolving on `onYouTubeIframeAPIReady` and refusing with a stated reason on load failure or timeout, in `src/player/iframe-api.ts`
- [ ] T114 [US1] Adapt `YT.Player` to `YouTubePlayer` with `playerVars: { origin: location.origin, playsinline: 1 }`, exposing `onStateChange`, `onError` and `onAutoplayBlocked` as observable events, in `src/player/youtube-adapter.ts`
- [ ] T115 [US1] Make every mutating playback tool await the player's own confirmation for at most one second and report what it confirmed — `refused_by_player` with the actual state, or `autoplay_blocked` — in `src/player/readback.ts`, `src/player/tools/transport.ts`, `src/player/tools/seek.ts`, `src/player/tools/rate-volume.ts` and `src/player/tools/captions.ts`
- [ ] T116 [US1] Mount the real player; make a result's **Play** and queue advancement load the video; move `createLocalPlayer` out of the application into `tests/support/local-player.ts`, in `src/App.tsx` and `src/player/player-view.tsx`
- [ ] T117 [US1] Wire `onError` to availability through `availabilityFromError` and `isOriginError`, showing the specific reason on the result and queue entry (FR-036), in `src/player/player-view.tsx` and `src/catalog/results-view.tsx`

**Checkpoint**: nothing in `src/` constructs a stand-in player; Scenario 1 passes against the fake and
the live suite.

---

## Phase 11: Foundational — the gateway and MCP client

**Purpose**: Let the backend reach the page's tools (R6). Tested on a real socket, never only an
in-process transport.

### Tests for Phase 11

- [ ] T118 [P] Integration test on a real `ws` server bound to an ephemeral port: a valid ticket is redeemed during the upgrade; unknown, expired and replayed tickets get HTTP 401 and the client never sees `open`; a frame that is not JSON-RPC is reported and dropped; `onclose` fires exactly once however the socket ends; a connection counts as ready only after `initialize` completes, in `tests/integration/gateway.test.ts`
- [ ] T119 [P] Integration test: the tool listing is cached per connection and invalidated by `notifications/tools/list_changed`; a second connection for the same session replaces the first; tools that vanish mid-turn are handled by the loop's existing path, in `tests/integration/gateway-tool-listing.test.ts`

### Implementation for Phase 11

- [ ] T120 Issue the anonymous session cookie (`HttpOnly; SameSite=Strict; Path=/api`) from `POST /api/mcp-ticket` and record the session on the ticket, in `server/ticket/session.ts` and `server/ticket/route.ts`
- [ ] T121 Accept WebSocket upgrades on `/mcp` with `WebSocketServer({ noServer: true })`, redeeming the ticket before the handshake and binding the connection to its session, in `server/gateway/upgrade.ts`, wired in `server/index.ts`
- [ ] T122 Implement the frame `Transport` (the SDK's `deserializeMessage`, no `start()` outside `client.connect()`, `onclose` once) and a bounded `initialize`, in `server/gateway/transport.ts`
- [ ] T123 Implement the per-session page connection exposing the loop's `ToolTransport` over a cached listing invalidated by `list_changed`, in `server/gateway/page-connection.ts`
- [ ] T124 Verify the Messages API tool-name limit against the current API reference (the reference gateway says 64, this code says 128) and make the alias map refuse a name over it rather than let the request fail, in `server/agent/tool-names.ts`
- [ ] T125 Use the cached listing instead of re-listing every iteration, keeping the vanished-tools finalisation, in `server/agent/loop.ts`

---

## Phase 12: Foundational — assistant turns, allowance, and the page's turn client

**Purpose**: Carry a command to the assistant and its progress back (R8, R9, FR-046).

### Tests for Phase 12

- [ ] T126 [P] Integration test of the allowance: per-session and per-day limits checked before any model work; concurrent turn starts cannot overspend; rollover at the same Pacific midnight as the search budget; a cancelled admitted turn still counts, in `tests/integration/assistant-allowance.test.ts`
- [ ] T127 [P] Integration test of the turn endpoint: SSE events in order with `done` always last; 409 `assistant_unavailable`, 429 `assistant_allowance_spent` (with `limit` and `resetsAt`) and 503 before the stream opens; `commandId` written over any model-supplied value and absent from the model's schema; two concurrent turns attributed exactly; aborting the request aborts the model stream and sends MCP cancellation; an assistant call refused before its handler (bad arguments) appears in the activity record WITH its arguments and `commandId` — the provider's value payloads, unverifiable before a gateway exists (Phase 9 Gate C round 6), in `tests/integration/assistant-turns.test.ts`
- [ ] T128 [P] Integration test of the page's turn client: the acknowledgement renders before any network call; a turn without `done` at ten seconds becomes `late` and stays cancellable; cancelling revokes the command before aborting the request, in `tests/integration/turn-client.test.ts`

### Implementation for Phase 12

- [ ] T129 Extract the Pacific-midnight calculation into one owner used by both budgets, and implement `AssistantAllowance`, in `server/time/pacific-day.ts`, `server/catalog-proxy/budget.ts` and `server/assistant/allowance.ts`
- [ ] T130 Implement `POST /api/assistant/turns`: session → connection, allowance admission, the SSE stream, `commandId` injection on every forwarded call, cancellation, in `server/assistant/turns.ts`, routed from `server/routes.ts`
- [ ] T131 Add a scripted model client for deterministic e2e runs, enabled only by an explicit environment variable and **refusing to start when `ANTHROPIC_API_KEY` is also set**, so a scripted run cannot pass itself off as a live one, in `server/agent/scripted-client.ts`
- [ ] T132 Implement the page's turn client: matcher fall-through → local acknowledgement → SSE reader → `late` at ten seconds → cancel, in `src/assistant/turn-client.ts`
- [ ] T133 Show turns — acknowledged, running, late, done, refused, cancelled — with their tool calls and the allowance and reset time, replacing "the assistant is not connected", in `src/assistant/turn-view.tsx` and `src/App.tsx`
- [ ] T134 Report the assistant available only once the socket is admitted **and** the backend has listed the page's tools, and unavailable with the reason when the allowance is spent (FR-037, FR-046), in `src/mcp/connection-status.tsx`

**Checkpoint**: a typed command the matcher cannot handle reaches the assistant and acts on the page;
the whole path runs deterministically with the scripted client and live with the key.

---

## Phase 13: Every story, conversationally

**Purpose**: US1–US4's acceptance scenarios were satisfied by hand and by the matcher; these prove
them through the assistant, on the real page and the real gateway, with the scripted model client.

- [ ] T135 [P] [US1] Playwright: "go back a bit" acknowledged within one second and applied when the assistant acts; pause pressed before the assistant acts applies and the seek is refused `overtaken_by_newer_command` (FR-038, SC-001), in `tests/e2e/assistant-playback.spec.ts`
- [ ] T136 [P] [US2] Playwright: find, then "only the short ones" spending no quota, then "play the third one"; with the results view closed, the assistant is told the view is not open rather than acting on a stale listing (FR-016, FR-035, SC-012), in `tests/e2e/assistant-discovery.spec.ts`
- [ ] T137 [P] [US3] Playwright: every assistant tool call appears once in the activity record under its command; an assistant entry can be undone; "what did you just do?" matches the record (FR-029, FR-030, FR-033), in `tests/e2e/assistant-activity.spec.ts`
- [ ] T138 [P] [US4] Playwright: an assistant removal names its target and waits; "maybe" refuses; a bulk change over five states the count (FR-026, FR-027, FR-028), in `tests/e2e/assistant-curation.spec.ts`

---

## Phase 14: Live verification and evidence

**Purpose**: The runs that need the real key and network, and the evidence the constitution requires.

- [ ] T139 Live Scenario 7 against the real backend, key and page — availability after listing, a find-and-narrow turn, the closed-view refusal, a cancelled turn, and a replayed ticket refused at the upgrade — in `tests/e2e-live/assistant.live.spec.ts`
- [ ] T140 Live timing: acknowledgement and result for SC-001 and SC-012 measured from end of input; if SC-012 fails, pull R9's levers in order and record the measurements and what was pulled, in `tests/e2e-live/timing.live.spec.ts` and `specs/001-voice-video-control/research.md`
- [ ] T141 Extend the break-it pass with named mutations for: the fence checked at entry instead of application, `commandId` not overwritten, the upgrade accepting before redemption, the allowance checked after model work, and a player tool not awaiting confirmation, in `scripts/break-it-pass.mjs`
- [ ] T142 Reconcile the projections — contracts, data model, quickstart, and this file's "Found after closeout" entries marked resolved — and record in `.claude/kaliper/phased-implement/NOTES.md` every incident the green suite missed during these phases

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup (T001–T006)
   ↓
Foundational (T007–T027)  ← BLOCKS everything; spikes T007/T008 first
   ↓
US1 (T028–T047)  🎯 MVP — independent
   ↓
US2 (T048–T062)  — independent of US1 except the shared foundation
   ↓
US3 (T063–T071)  — needs actions to exist; US1 alone is sufficient
   ↓
US4 (T072–T081)  — builds on US3's record and undo
   ↓
Polish (T082–T090)
   ↓
── Revision 2026-09-13 ──────────────────────────────
Setup (T091–T094)
   ↓
Tool surface + issue fence (T095–T109)  ← BLOCKS every conversational task
   ↓                         ↘
US1 real player (T110–T117)    (independent of the gateway; may run beside T118–T125)
   ↓
Gateway + MCP client (T118–T125)
   ↓
Turns, allowance, turn client (T126–T134)
   ↓
Every story, conversationally (T135–T138)  — US1–US4 independent of each other
   ↓
Live verification and evidence (T139–T142)
```

The plan puts the player first; it is placed after the fence here only because T115 changes tools the
fence wraps. If the fence slips, T110–T117 can land first — T102 then adapts the awaited tools rather
than the other way round.

### User Story Dependencies

- **US1** depends only on the foundation. It is the MVP.
- **US2** depends only on the foundation. Could be built before US1 if priorities changed.
- **US3** needs *some* story's actions to record; US1 satisfies that.
- **US4** is the only story with a real predecessor — its discarding operations should land on top of
  US3's record and undo, per the spec's own priority reasoning.

### Parallel Opportunities

| Phase | Parallel set |
|---|---|
| Setup | T002, T003, T004, T005 |
| Foundational | T009–T012 (vocabularies); T017–T019 (persistence); T023–T025 (backend routes) |
| US1 | T028–T030 (tests); T034–T036, T038, T039 (independent tool files) |
| US2 | T048–T050 (tests); T054, T055, T058, T059, T062 |
| US3 | T063–T065 (tests); T069 |
| US4 | T072–T074 (tests); T075, T076, T079, T080 |
| Revision setup | T093, T094 |
| Tool surface + fence | T095–T098 (tests); T106–T109 (one view each, after T101–T105) |
| US1 real player | T110–T112 (tests) |
| Gateway | T118, T119 (tests) |
| Turns | T126–T128 (tests) |
| Conversational stories | T135–T138 |

Tool declarations in separate files parallelize well; anything touching `src/player/player.ts`,
`src/catalog/results.ts` or the activity writer does not.

---

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That is 47 tasks and delivers hands-free playback
control — the slice that proves the architectural claim and is useful on its own.

**Sequence the two spikes first.** T007 (captions) and T008 (recognition availability) can each turn a
requirement into a different requirement. T007 may reduce FR-010 to "say captions are unsupported
here"; T008 may promote the Whisper fallback from footnote to work item. Both are cheaper to learn
before their phase is estimated than after it is half-built.

**T006 is not paperwork.** Until `gates.json` names real commands, every `kaliper:phased-implement`
gate reports NOT RUN, and the phase workflow this project is built around does nothing.

**Revision 2026-09-13 — the MVP of the revision is Phases 8–12 plus T135.** That is the first moment
a person can type something the matcher does not recognise and watch the real player respond. Phase 10
alone is worth shipping first if the gateway slips: it replaces a stand-in with the product.

**Two rules this revision exists because of.** A task naming a behaviour is not done when a file with
that name exists — T020, T031 and T034 were. And a deterministic run never stands in for a live one:
T131's scripted client refuses to start beside a real key, and every story phase has a live
counterpart in `tests/e2e-live/`.

**Each checkpoint is a demo.** Stop at any of them and what exists works by hand and by voice, with
the assistant's actions visible and reversible from US3 onward.
