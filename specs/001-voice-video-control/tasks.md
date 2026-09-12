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

- [X] T020 Wire `AgentMcpProvider` with Ajv validator, `onUnexpectedState`, and `capabilities` fixing `dom.inspect`/`dom.interact`/`evaluate` to false, in `src/mcp/provider.tsx`
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

- [X] T031 [US1] Implement the IFrame player wrapper with state mapping and `onError`/`onStateChange`/`onAutoplayBlocked` handlers in `src/player/player.ts`
- [X] T032 [US1] Implement **readback verification** — `getPlaybackRate`, `getVolume`, `isMuted` after every set, reporting platform refusal rather than success (FR-008, FR-009) — in `src/player/readback.ts`
- [X] T033 [US1] Implement ad detection gating commands the player refuses during ads (FR-014) in `src/player/ad-gate.ts`
- [X] T034 [P] [US1] Declare `playback.play`/`pause`/`stop` tools in `src/player/tools/transport.ts`
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
- [X] T046 [US1] Implement in-flight command cancellation (FR-004) in `src/app/command-cancel.ts`
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

- [ ] T072 [P] [US4] Contract tests for `curation.*` tools including every confirmation gate in `tests/contract/curation-tools.test.ts`
- [ ] T073 [P] [US4] Test that an unclear confirmation response **abandons** the action (FR-028) in `tests/integration/unclear-confirmation-refuses.test.ts`
- [ ] T074 [P] [US4] Test that actions above five references state the count and require confirming it (FR-027) in `tests/integration/bulk-threshold.test.ts`

### Implementation for User Story 4

- [ ] T075 [P] [US4] Implement collection state with case-insensitive unique names, refusing duplicates rather than merging, in `src/curation/collections.ts`
- [ ] T076 [P] [US4] Implement tags and personal labels, keeping person-owned fields separate from cached YouTube fields, in `src/curation/annotations.ts`
- [ ] T077 [US4] Declare `curation.createCollection` and `addToCollection` in `src/curation/tools/collections.ts`
- [ ] T078 [US4] Declare `curation.removeFromCollection` and `deleteCollection` with `confirmation: 'required'` in `src/curation/tools/discard.ts`
- [ ] T079 [P] [US4] Declare `curation.setLabel` asserting `sourceTitleUnchanged` in its result so FR-025 is observable, in `src/curation/tools/label.ts`
- [ ] T080 [P] [US4] Declare `curation.addTags`/`removeTags` in `src/curation/tools/tags.ts`
- [ ] T081 [US4] Implement collection and tag UI showing which fields are the person's own in `src/curation/curation-view.tsx`

**Checkpoint**: All four stories delivered.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The requirements that are cross-cutting by nature, and the evidence the constitution
requires. **These are not optional cleanup** — Scenario 5 and 6 are where this system's characteristic
failure would hide.

- [ ] T082 Implement the disclosure that command text and video titles reach an external language model service (FR-045) in `src/app/privacy-disclosure.tsx`
- [ ] T083 Implement assistant-unavailable state keeping the whole interface usable by hand (FR-037) in `src/mcp/connection-status.tsx`
- [ ] T084 Implement command ordering — applied in the order issued, or explicitly refused (FR-038) — in `src/app/command-queue.ts`
- [ ] T085 Implement the unavailable-view refusal naming the view that owns the capability (FR-035) in `src/mcp/tool-availability.ts`
- [ ] T086 [P] Implement clearing of command transcript history (FR-041) in `src/app/history-controls.tsx`
- [ ] T087 Playwright **failure matrix** covering quickstart Scenario 5: recognition unavailable, agent disconnected, quota exhausted, video removed/embedding disallowed, ad in progress, view not open — each asserting a stated reason (SC-009) — in `tests/e2e/failure-matrix.spec.ts`
- [ ] T088 Playwright **privacy assertions** covering quickstart Scenario 6: no request carries audio (SC-013), capture indicator matches capture window (SC-011), disclosure present (FR-045), in `tests/e2e/privacy.spec.ts`
- [ ] T089 **Break-it-to-prove-it pass**: for each confirmation gate, the no-bare-success invariant and the no-audio-egress assertion, delete the check, confirm red, restore, and record it in `.claude/kaliper/phased-implement/NOTES.md`
- [ ] T090 Record in `.claude/kaliper/phased-implement/NOTES.md` every incident a green suite missed during live runs

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
```

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

**Each checkpoint is a demo.** Stop at any of them and what exists works by hand and by voice, with
the assistant's actions visible and reversible from US3 onward.
