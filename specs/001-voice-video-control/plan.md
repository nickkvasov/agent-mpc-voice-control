# Implementation Plan: Agentic Voice and Text Control of a Video Library

**Branch**: `001-voice-video-control` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

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

## Technical Context

**Language/Version**: TypeScript 5.x, ESM only; Node ≥ 22 (toolchain floor set by `agent-mcp-react`)

**Primary Dependencies**: `agent-mcp-react` (in-page MCP server) · React ≥ 18 · YouTube IFrame Player
API (playback) · YouTube Data API v3 (catalog, via backend proxy) · `@anthropic-ai/sdk` on
`claude-opus-5` (agent loop, server-side) · Ajv (the validator `agent-mcp-react` requires) · Web
Speech API with `processLocally`

**Storage**: IndexedDB in the browser. No server-side user store — the feature is anonymous (FR-042),
single-person (Assumptions), and the application owns its state (FR-005), so there is nothing a
server database would be the owner of.

**Testing**: Vitest (tool schemas, activity record, reducers) · Playwright + chromium (live browser
scenarios and the SC-001/SC-012 timing assertions)

**Target Platform**: Desktop browsers in a secure context. Engine floor from `agent-mcp-react` is
Chrome 116 / Safari 17.4 / Firefox 124; **on-device recognition narrows voice support further**, and
that narrower set is a runtime probe, not a documented matrix (R1).

**Project Type**: Web application — browser app plus a thin backend (ticket minter, catalog proxy,
agent host).

**Performance Goals**: Playback commands visible within **1s of end-of-speech** (SC-001); discovery,
queueing and curation within **3s** (SC-012); player controls reflect a change within 1s (FR-013).

**Constraints**: 100 `search.list` calls/day application-wide · no raw audio off-device (FR-043,
SC-013) · secure context required · no API key in the browser · YouTube's terms govern playback ·
captions control is barely documented and may prove unsupported (R4).

**Scale/Scope**: One person per session; catalog is external and unbounded; collections and tags are
local and small (hundreds, not millions). 4 user stories, 45 functional requirements, 13 success
criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The governing constitution is `.claude/kaliper/constitution.md` (IMMUNE).
**`.specify/memory/constitution.md` is still an unfilled template** and owns nothing; per IMMUNE-N it
must not become a second authority — either fill it via `/speckit-constitution` and delete the kaliper
copy, or leave it unused.

| Principle | Gate | Pre-Phase 0 | Post-Phase 1 |
|---|---|---|---|
| **IMMUNE-I** Intent before implementation | Requirements captured testably outside the code | **PASS** — 45 FRs, 13 SCs, 16/16 checklist | **PASS** — tool contract and data model are the missing middle layer; a tool handler could be deleted and regenerated from `contracts/mcp-tools.md` |
| **IMMUNE-M1** Mutations preserve coherence | Every projection of a concept changes together | **PASS** — clarifications were propagated, not appended | **PASS** — a tool is one concept with four projections (schema, handler, activity description, contract row); tasks must change them together |
| **IMMUNE-M2** Meta over patch | Fix the generator of a class of error | **PASS** | **PASS** — the "no bare success" rule is a contract-wide invariant with one test, not a per-handler review |
| **IMMUNE-U** Unexpected states fail loud | No silent success, no convenience default | **PASS** — SC-009 requires a stated reason for every refusal | **PASS** — `{ok:false, reason}` is structural; three-valued `hasCaptions`/`chapters`/`quotaRemaining` make "unknown" representable; `Command` has no terminal state without an outcome |
| **IMMUNE-N** No duplicated authority | One owner per truth | **PASS** — the app owns state; the assistant holds none | **PASS with one tracked item** — two command interpreters; contained by making the tools the sole owner of meaning (see Complexity Tracking) |
| **IMMUNE-E** Every state explainable | State reconstructable from evidence, negatives included | **PASS** — FR-029..FR-033 | **PASS** — `ActivityRecord` is this principle as a schema; `failureDetail` records the negative; `supersededBy` names why an undo is unavailable instead of hiding the button |

**Both gates pass.** One item is tracked below rather than waived.

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
├── ticket/                   # POST /api/mcp-ticket
├── catalog-proxy/            # YouTube Data API + cache + quota accounting
└── agent/                    # Claude API agent loop, MCP client

tests/
├── contract/                 # every tool: schema rejection, ok:false paths
├── integration/              # activity record, undo, confirmation gates
└── e2e/                      # Playwright: quickstart scenarios 1-6
```

**Structure Decision**: Web application with a thin backend. Each feature area owns its tools in a
`tools/` subdirectory beside the state they act on — this is what makes FR-035 ("the capability is not
on screen") a natural consequence of the structure rather than a check someone has to remember, since
a tool is declared by the component that owns the state it mutates. The backend holds exactly the
three things the browser must not: the Anthropic key, the YouTube key, and the shared quota.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two command interpreters (local matcher + Claude agent) — risks duplicating authority over what an utterance means (IMMUNE-N) | SC-001 requires a visible result within 1s of end-of-speech; a remote model round-trip cannot reliably meet that for "pause". The playback vocabulary is closed and finite, which is where a matcher is appropriate | *Agent-only* fails SC-001 for the most common commands. *Matcher-only* cannot handle open-ended discovery or curation. *Speculative execution of both* doubles cost and creates conflicts the activity record would have to explain — rejected under Proportionate Engineering. **Containment:** the tools are the single owner of what an action does; both paths call the same tools and write the same activity record; the matcher falls through to the agent rather than guessing, so the two never interpret the same utterance |

## Phase 2 note

`/speckit-tasks` generates `tasks.md`. Two items should be sequenced early because they can invalidate
estimates rather than merely delay them:

- **The captions spike (R4).** Enabling a caption track is not part of the documented IFrame surface.
  FR-010 may reduce to "say that captions are unsupported here" — better known before its tasks are
  estimated than after.
- **The on-device recognition probe (R1).** If `processLocally` support proves too narrow, voice
  becomes a minority path and the Whisper/WebGPU fallback moves from a footnote to a work item.
