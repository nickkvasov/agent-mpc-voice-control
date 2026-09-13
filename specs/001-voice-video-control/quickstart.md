# Quickstart: Validating Agentic Voice and Text Control

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12, revised 2026-09-13

How to prove this feature works end to end. Each scenario maps to requirements in
[spec.md](./spec.md) and is runnable without reading the implementation.

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node ≥ 22.18 | The backend runs `.ts` directly (type stripping on by default) | `node -v` |
| A secure context | The tool registry is only defined in one; `localhost` counts | served over `localhost` or https |
| Chrome with on-device recognition | R1 — voice is refused without it | `await SpeechRecognition.available({processLocally:true})` |
| `YOUTUBE_API_KEY` | Catalog proxy | backend env |
| `ANTHROPIC_API_KEY` | Agent loop | backend env, **never** in the browser |
| Playwright + chromium | Live browser scenarios | already installed |

**Quota warning:** the deployment gets **100 `search.list` calls per day, shared** (R2). Scenarios
marked ⚠ spend quota. Run them against the cache or a recorded fixture during development; a single
careless test loop can exhaust a day.

## Setup

```bash
npm install
npm run server       # backend on :8787 — reads YOUTUBE_API_KEY / ANTHROPIC_API_KEY from dev.env or .env
npm run dev          # frontend on :5273, proxies /api to the backend (second terminal)
```

## Scenario 1 — Playback control (P1, no quota)

Load a known video directly, then:

| Say / type | Expect | Proves |
|---|---|---|
| "pause" | playback stops, control shows paused, **within 1s of you finishing speaking** | FR-006, SC-001 |
| "go back a bit" (the app does not recognise it) | acknowledgement **within 1s**; seek applied when the assistant acts; no deadline, cancellable | SC-001, FR-004 |
| "skip forward two minutes" | position +120s, scrubber agrees | FR-007, FR-013 |
| "speed it up a bit" | rate changes **and the system states which rate** | FR-008 |
| "turn on subtitles" | captions on, or a clear statement that this video has none | FR-010 |
| "pause" with nothing playing | says nothing is playing | FR-006 acceptance 6 |

Run each twice — once by voice, once typed. **Identical outcomes required** (FR-001).

**Against the real player.** Every row above must also pass in `test:e2e:live`, against the real
embed. A row that passes only against the fake IFrame API has not been verified: that is how the
stand-in went unnoticed (R10).

**Timing:** measure from end-of-speech, not from recognition. The one-second budget includes
recognition and round-trip; measuring from "understood" hides exactly what SC-001 was rewritten to
expose.

## Scenario 2 — Discovery and queue (P2) ⚠

| Say | Expect | Proves |
|---|---|---|
| "find talks about state machines from this year" | acknowledged within 1s; results within **10s**, or shown as **late**; topic **and** dates match; criteria stated | FR-015, FR-021, SC-012 |
| "only the short ones" | narrows **within** the previous results; **spends no quota** | FR-016, R2 |
| "play the third one" | that video plays; list untouched | FR-017 |
| "play the one about launches" (2+ matches) | asks which; does not choose | FR-018 |

Verify the second step made **no** network call to the catalog proxy. If it did, the quota-preservation
design is not working and the feature will be unusable by mid-afternoon.

## Scenario 3 — Activity record and undo (P3, no quota)

1. Issue several commands, including one that fails.
2. Open the activity record → every action present, in interface vocabulary (FR-029, SC-006).
3. Undo a **non-most-recent** reversible entry → prior state restored (FR-030).
4. Confirm the undo itself appears as a new entry (FR-031).
5. Find an entry a later action depends on → it must say it can no longer be undone and **not offer
   the button** (FR-044).
6. Ask "what did you just do?" → answer matches the record exactly (FR-033).

## Scenario 4 — Curation and confirmation (P4, no quota)

| Say | Expect | Proves |
|---|---|---|
| "tag these three as onboarding" | exactly those three tagged | FR-024 |
| "call this one Q3 retro" | personal label applied; **states the source title is unchanged** | FR-025 |
| "remove this from Favorites" | names video and collection, waits | FR-026 |
| "maybe?" at a confirmation | action **abandoned** | FR-028 |
| empty a collection of 6+ | states the count, requires confirming that count | FR-027 |

## Scenario 5 — Failure behavior (the one most likely to be skipped)

| Condition | Expect | Proves |
|---|---|---|
| On-device recognition unavailable | voice refused with a reason; text still works | R1, FR-001 |
| Agent disconnected | commands refused with a reason; **whole app usable by hand** | FR-037, SC-010 |
| Assistant allowance spent (lower the limits to 1 to reach it) | assistant shown unavailable with which limit and when it resets; recognised commands still work | FR-046, SC-014 |
| Slow search, then press pause | pause applies **at once**; the search still completes | FR-038 |
| "go back a bit", then press pause before the assistant acts | pause applies; the assistant's seek is **refused with the reason**, not applied over it | FR-038 |
| Autoplay blocked by the browser | says playback was blocked and asks for a press — never reports playing | R10, SC-009 |
| Page served from `file://` | player error 153 reported as an origin problem, not as the video being unavailable | R4, FR-036 |
| Quota exhausted | stated; loaded results, queue, playback still work | FR-022 |
| Video removed / embedding disallowed | the **specific** reason, not a generic failure | FR-036 |
| Command during an ad | deferred or refused, never accepted-and-dropped | FR-014 |
| Ask for something whose view isn't open | says so; does not act on a stale view | FR-035 |

Every row must produce a **stated reason** (SC-009). A silent no-op is a defect, not a cosmetic gap —
this scenario is where the characteristic failure of this system would hide.

## Scenario 6 — Privacy (SC-011, SC-013)

1. With devtools open, hold to talk and confirm **no outbound request carries audio** (SC-013).
2. Confirm capture indicator is visible for exactly the capture window, and audio is not captured
   outside it (FR-002, SC-011).
3. Confirm the interface discloses that command text and video titles go to an external language
   model service (FR-045) — this is the claim FR-043 would otherwise be misread as denying.

## Scenario 7 — The assistant, end to end (real key, real backend) ⚠

Spends assistant turns and, for row 2, one search.

1. Start the backend and the page. The assistant indicator must move from unavailable to available only
   once the page's socket is admitted **and** the backend has listed its tools — not when the socket
   opens (R6).
2. Type "find talks about finite state machines, only the short ones". Expect: acknowledgement at once;
   `tool_call`s visible as they happen; one search, then a narrow that spends **no** quota; the activity
   record gains one entry per tool call.
3. Close the results view and ask "play the third one". Expect the assistant to say the results are not
   open — it must not act on a listing it cached before the view closed (FR-035, R6).
4. Start a long request and cancel it. Expect `done` with `cancelled`; any handler already running sees
   its signal abort; the turn still counts against the allowance (FR-004, R9).
5. Replay a used ticket URL by hand (`websocat` or a script). Expect **HTTP 401 on the upgrade** and no
   open socket (R6).

## Automated coverage

| Layer | Tool | Covers |
|---|---|---|
| Tool schemas | Vitest | Every tool rejects bad input; every failure path returns `ok:false` + reason |
| Activity record | Vitest | One entry per invocation, refusals included; undo writes its own entry |
| Gateway and turn stream | Vitest | Upgrade refused before handshake; frames validated; list cache invalidated on `list_changed`; SSE order with `done` last; cancellation reaches the page |
| Browser, deterministic | Playwright + fake IFrame API | Scenarios 1–5 and 7, including the player events that never arrive |
| Browser, live | `test:e2e:live` | Scenario 1 against the real embed; Scenario 7 against the real backend and key |
| Timing | Playwright | SC-001 / SC-012 acknowledgement and result, measured from end-of-speech |

A green suite does not discharge Scenario 5 or 6 — both are about what the system does when something
is wrong, which is where mocked tests are least trustworthy. Record anything a green suite missed in
`.claude/kaliper/phased-implement/NOTES.md`.
