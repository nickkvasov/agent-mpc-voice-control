# Implementation Plan: Agentic Voice and Text Control of a Video Library

**Branch**: `001-voice-video-control` | **Date**: 2026-09-12, revised 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-voice-video-control/spec.md`

## Summary

A React application that plays YouTube videos and publishes its own actions as typed MCP tools, so a
Claude-driven assistant can drive it by voice or text instead of clicking. The application keeps
owning its state; the assistant only calls tools.

Three findings from Phase 0 shape the architecture more than anything in the spec did:

1. **The default browser speech API may process audio remotely**, so on-device recognition must be
   probed and voice refused when unavailable — otherwise the feature would violate FR-043 while
   appearing to work (R1).
2. **YouTube allows 100 searches per day for the whole deployment**, not per person. Local narrowing
   becomes the mechanism that keeps discovery usable, and quota exhaustion is a daily condition to
   design for rather than an edge case (R2).
3. **SC-001's one-second budget cannot be met through a remote model round-trip**, so a local
   deterministic matcher handles the closed playback vocabulary and the agent handles everything else
   (R3).

### Revision 2026-09-13

Live verification with real credentials, then a second clarification session, reopened the plan. What
the running application lacked, and what the spec now asks instead:

- **No YouTube player.** The page drove an in-memory stand-in; T031 had produced only the interface.
  The adapter must await the player's own confirmation, because a real player answers asynchronously
  and an immediate readback reports the previous state as the result (R10).
- **No path from an utterance to the assistant.** The gateway, the MCP client and the turn endpoint are
  new (R6, R9).
- **No MCP tools published** (found while writing tasks). `AgentMcpProvider` is never mounted and no
  component calls `useMcpTool`; the tools exist only as functions buttons and the matcher call. Every
  tool must be registered by the component owning its state before a gateway has anything to reach
  (Principle II, FR-035).
- **SC-001 and SC-012 now split by path.** Every command is acknowledged within 1s, locally. Commands
  the application recognises keep 1s (playback) and 3s (discovery) for their result;
  assistant-interpreted commands have no result deadline (playback) or ten seconds (discovery) (R9).
- **FR-038 orders commands within a domain, not globally**, and refuses an assistant action a newer
  command has overtaken (R7).
- **FR-046 bounds assistant spend** per session and per day (R8).

## Technical Context

**Language/Version**: TypeScript 5.x, ESM only; Node ≥ 22.18 (`agent-mcp-react` sets 22; the backend runs `.ts` directly, which needs type stripping on by default, 22.18+)

**Primary Dependencies**: `agent-mcp-react` (in-page MCP server) · React ≥ 18 · YouTube IFrame Player
API (playback) · YouTube Data API v3 (catalog, via backend proxy) · `@anthropic-ai/sdk` on
`claude-opus-5` (agent loop, server-side) · `@modelcontextprotocol/client` 2.x and `ws` 8.x (gateway
and MCP client, server-side — R6) · Ajv (the validator `agent-mcp-react` requires) · Web Speech API
with `processLocally`

**Storage**: IndexedDB in the browser. No server-side user store — the feature is anonymous (FR-042),
single-person (Assumptions), and the application owns its state (FR-005), so there is nothing a
server database would be the owner of.

**Testing**: Vitest (tool schemas, activity record, reducers, gateway and turn endpoint against a real
`ws` socket on an ephemeral port) · Playwright + chromium against a **fake IFrame API** served by route
interception (deterministic scenarios, SC-001/SC-012 timing) · `test:e2e:live` against the **real
embed and real backend** (Gate B and final gate only — R10)

**Target Platform**: Desktop browsers in a secure context. Engine floor from `agent-mcp-react` is
Chrome 116 / Safari 17.4 / Firefox 124; **on-device recognition narrows voice support further**, and
that narrower set is a runtime probe, not a documented matrix (R1).

**Project Type**: Web application — browser app plus a thin backend (ticket minter, catalog proxy,
gateway, agent host), one Node process.

**Performance Goals**, all measured from end of speech:

| | Acknowledged | Result — recognised by the app | Result — interpreted by the assistant |
|---|---|---|---|
| Playback (SC-001) | 1s | 1s | no deadline; cancellable |
| Discovery, queue, curation (SC-012) | 1s | 3s | 10s, then shown as **late** |

Player controls reflect a change within 1s (FR-013). The acknowledgement is rendered locally before any
network call, so it does not depend on the model (R9).

**Constraints**: 100 `search.list` calls/day application-wide · assistant turns capped per session and
per day (FR-046, R8) · no raw audio off-device (FR-043, SC-013) · secure context required · no API key in
the browser · YouTube's terms govern playback · the IFrame API needs a real HTTP origin (error 153) ·
caption disable is unverifiable (R4) · `agent-mcp-react` gives a tool handler no call metadata (R7).

**Scale/Scope**: One person per session; catalog is external and unbounded; collections and tags are
local and small (hundreds, not millions). 4 user stories, 46 functional requirements, 14 success
criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Two constitutions govern, and they do not overlap.
`.specify/memory/constitution.md` v1.0.0 owns **what this system must be** (Principles I–VII);
`.claude/kaliper/constitution.md` owns **how work is done** (IMMUNE). Neither restates the other —
each project principle that is an instance of an IMMUNE principle cites it rather than repeating it,
which is what keeps IMMUNE-N satisfied with both files present.

| Principle | Gate | Pre-Phase 0 | Post-Phase 1 |
|---|---|---|---|
| **IMMUNE-I** Intent before implementation | Requirements captured testably outside the code | **PASS** — 45 FRs, 13 SCs, 16/16 checklist | **PASS** — tool contract and data model are the missing middle layer; a tool handler could be deleted and regenerated from `contracts/mcp-tools.md` |
| **IMMUNE-M1** Mutations preserve coherence | Every projection of a concept changes together | **PASS** — clarifications were propagated, not appended | **PASS** — a tool is one concept with four projections (schema, handler, activity description, contract row); tasks must change them together |
| **IMMUNE-M2** Meta over patch | Fix the generator of a class of error | **PASS** | **PASS** — the "no bare success" rule is a contract-wide invariant with one test, not a per-handler review |
| **IMMUNE-U** Unexpected states fail loud | No silent success, no convenience default | **PASS** — SC-009 requires a stated reason for every refusal | **PASS** — `{ok:false, reason}` is structural; three-valued `hasCaptions`/`chapters`/`quotaRemaining` make "unknown" representable; `Command` has no terminal state without an outcome |
| **IMMUNE-N** No duplicated authority | One owner per truth | **PASS** — the app owns state; the assistant holds none | **PASS with one tracked item** — two command interpreters; contained by making the tools the sole owner of meaning (see Complexity Tracking) |
| **IMMUNE-E** Every state explainable | State reconstructable from evidence, negatives included | **PASS** — FR-029..FR-033 | **PASS** — `ActivityRecord` is this principle as a schema; `failureDetail` records the negative; `supersededBy` names why an undo is unavailable instead of hiding the button |

### Project principles (`.specify/memory/constitution.md` v1.0.0)

| Principle | Where this design satisfies it |
|---|---|
| **I.** The application owns its state | The assistant holds none; tools mutate app state only (FR-005, SC-010) |
| **II.** One tool surface | `contracts/mcp-tools.md` is the sole owner of meaning; `dom` and `evaluate` permanently off; tools declared beside the state they change, so FR-035 falls out of the structure |
| **III.** No bare success | `{ok:false, reason}` is contract-wide with one test, not per-handler review |
| **IV.** Unknown is a value | Three-valued `hasCaptions`, `chapters`, `searchCallsRemaining` in `data-model.md` |
| **V.** Recorded and reversible | `ActivityRecord` schema; `supersededBy` enforces FR-044 in data, not UI |
| **VI.** Destruction confirms | `confirmation: 'required'` on discarding tools; no "assume yes" resolver path |
| **VII.** Boundaries stated | FR-043 + FR-045 together; R1's refusal path rather than a silent remote fallback |

### Re-check after the 2026-09-13 revision (post-design)

| Principle | Verdict | Where |
|---|---|---|
| **IMMUNE-I** | **PASS** | FR-038, FR-046, SC-001, SC-012 and SC-014 were settled in the spec before any of R6–R10 was designed |
| **IMMUNE-M1** | **PASS, with one obligation** | A tool now has five projections — schema, domains, handler, activity description, contract row — plus the model-facing schema, which must be **derived** from the wire schema by removing `commandId`, never maintained beside it. A test compares their business constraints (R7) |
| **IMMUNE-M2** | **PASS** | Ordering is one fence in the invocation path for every caller, not a check per tool; player confirmation is one adapter rule, not per-tool readback |
| **IMMUNE-U** | **PASS** | The upgrade refuses before `open`; malformed frames are reported; `late`, `overtaken_by_newer_command`, `autoplay_blocked`, `assistant_allowance_spent` are stated outcomes; a player event that never arrives is a refusal, not a success |
| **IMMUNE-N** | **PASS, one item tracked** | `issueSeq` never crosses the wire, so the page stays the only owner of order; the backend owns the allowance and nothing else about a turn. The reserved field is tracked below |
| **IMMUNE-E** | **PASS** | Every attributed call writes one entry naming its command; a refusal names the newer command that overtook it; a turn's `done` carries its stop reason |
| **I.** App owns state | **PASS** | The backend holds sockets, allowances and in-flight requests — no application state |
| **II.** One tool surface | **PASS** | Clicks, matcher and assistant all pass the same fence; the gateway adds a transport, not a second path into state |
| **III.** No bare success | **PASS** | Player tools report what the player confirmed within 1s (R10) |
| **IV.** Unknown is a value | **PASS** | `durationSeconds` joins the three-valued fields; allowance remaining is `unknown` until established |
| **V–VII** | **PASS** | Unchanged by this revision; FR-045's disclosure already covers the assistant path now made real |

**Both gates pass.** Two items are tracked below rather than waived.

## Project Structure

### Documentation (this feature)

```text
specs/001-voice-video-control/
├── plan.md              # This file
├── research.md          # Phase 0 — R1..R5
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── mcp-tools.md     # The tool surface the page declares
│   └── backend-http.md  # Ticket minter, catalog proxy
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
src/
├── app/                      # React shell, routes, provider wiring
├── player/                   # IFrame Player wrapper; state readback (FR-008/FR-009)
│   └── tools/                # playback.* tool declarations
├── catalog/                  # results, narrowing, reference resolution
│   └── tools/                # catalog.* tool declarations
├── queue/
│   └── tools/                # queue.* tool declarations
├── curation/                 # collections, tags, labels
│   └── tools/                # curation.* tool declarations
├── activity/                 # the activity record, undo, inverses
│   └── tools/                # activity.* tool declarations
├── voice/                    # on-device recognition probe, push-to-talk control
├── matcher/                  # local deterministic playback matcher (R3)
├── store/                    # IndexedDB persistence
└── mcp/                      # AgentMcpProvider config, validator, confirmation resolver

server/
├── ticket/                   # POST /api/mcp-ticket; session cookie; ticket → session
├── catalog-proxy/            # YouTube Data API + cache + quota accounting
├── gateway/                  # ws upgrade on /mcp, frame transport, MCP client per page (R6)
├── assistant/                # POST /api/assistant/turns (SSE), allowance, cancellation (R8, R9)
└── agent/                    # Claude API agent loop

src/app/                      # + issue fence: issueSeq, per-domain order, stale refusal (R7)
src/player/                   # + IFrame API loader and adapter awaiting player events (R10)
src/assistant/                # turn client: local acknowledgement, SSE reader, late, cancel

tests/
├── contract/                 # every tool: schema rejection, ok:false paths, domain assigned
├── integration/              # activity record, undo, confirmation gates, gateway on a real socket
├── e2e/                      # Playwright against the fake IFrame API: quickstart scenarios 1-7
│   └── fixtures/             # the fake iframe_api, driven by the test
└── e2e-live/                 # real embed + real backend + real key; Gate B and final gate only
```

**Structure Decision**: Web application with a thin backend. Each feature area owns its tools in a
`tools/` subdirectory beside the state they act on — this is what makes FR-035 ("the capability is not
on screen") a natural consequence of the structure rather than a check someone has to remember, since
a tool is declared by the component that owns the state it mutates. The backend holds exactly the
three things the browser must not: the Anthropic key, the YouTube key, and the shared quota.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two command interpreters (local matcher + Claude agent) — risks duplicating authority over what an utterance means (IMMUNE-N) | SC-001 requires a visible result within 1s of end-of-speech for commands the application recognises; a remote model round-trip measured 4.5–6.2s (R9), so "pause" cannot go through it. The playback vocabulary is closed and finite, which is where a matcher is appropriate | *Agent-only* fails SC-001 for the most common commands. *Matcher-only* cannot handle open-ended discovery or curation. *Speculative execution of both* doubles cost and creates conflicts the activity record would have to explain — rejected under Proportionate Engineering. **Containment:** the tools are the single owner of what an action does; both paths call the same tools and write the same activity record; the matcher falls through to the agent rather than guessing, so the two never interpret the same utterance |

| A reserved `commandId` in every tool's input schema, stripped from the schema the model sees (R7) | `agent-mcp-react` 0.3.0 passes a handler no call metadata, and FR-038 now needs every assistant call attributed to its command to refuse the ones a newer command overtook | *One assistant turn at a time* makes unrelated turns wait (forbidden by FR-038) or refuses them (a policy the spec did not ask for). *Stamping with the oldest running turn* permits the stale overwrite it was meant to prevent. *A tool per turn* moves attribution into registration lifecycle. **Containment:** the field is defined once and added and removed mechanically; only the id crosses the wire; the model cannot set it. Retire it if the library starts passing request `_meta` to handlers |

## Phase 2 note

`/speckit-tasks` generates `tasks.md`. Two items should be sequenced early because they can invalidate
estimates rather than merely delay them:

- **The captions spike (R4).** Enabling a caption track is not part of the documented IFrame surface.
  FR-010 may reduce to "say that captions are unsupported here" — better known before its tasks are
  estimated than after.
- **The on-device recognition probe (R1).** If `processLocally` support proves too narrow, voice
  becomes a minority path and the Whisper/WebGPU fallback moves from a footnote to a work item.

**For the 2026-09-13 revision** — `tasks.md` holds 90 completed tasks and the findings recorded after
closeout. The new work is **appended as new phases**, never regenerated over them. Sequence it so each
phase is provable on its own:

1. **The real player first** (R10). It needs no credentials and no decisions, and every later live run
   depends on it — including the SC-001 measurements.
2. **The tool surface and the issue fence** (R7): mount the provider, register every tool with its
   domains, and replace the global `CommandChain`, with the consult's race tests. Page-only; it lands
   before anything can call a tool concurrently.
3. **Gateway and MCP client** (R6), tested on a real socket.
4. **Turn endpoint, allowance and the page's turn client** (R8, R9), including `commandId` injection.
5. **Live end-to-end and timing** — Scenario 7 and SC-001/SC-012 with the real key — which is where the
   R9 latency levers are pulled if needed.

`gates.json`'s `live.start` must start the backend as well as Vite before phase 3, or Gate B cannot
reach the assistant at all.
