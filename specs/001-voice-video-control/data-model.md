# Phase 1 Data Model: Agentic Voice and Text Control of a Video Library

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12, revised 2026-09-13 | **Spec**: [spec.md](./spec.md)

All persisted state lives in the browser (IndexedDB). There is no account and no server-side user
record (FR-042), and the application — not the assistant — owns every entity here (FR-005).

## Ownership

| Owner | Owns |
|---|---|
| React application state | Everything below. Single source of truth (IMMUNE-N). |
| YouTube | The media, and the canonical title/duration/channel of a video. Never written by this system. |
| The assistant | Nothing. It calls tools; it holds no state. |

A `VideoReference` therefore carries **two kinds of field**: cached facts owned by YouTube, and
curation owned by the person. The two must never be merged into one editable record — FR-025 requires
the person to be able to tell which is which.

---

## VideoReference

A pointer to a YouTube video plus what this system knows and the person has added.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `videoId` | string | YouTube | Identity. Unique across the store. |
| `title` | string | YouTube (cached) | Canonical title. Never edited. |
| `channelTitle` | string | YouTube (cached) | |
| `durationSeconds` | integer \| `unknown` | YouTube (cached) | Needed by "the shortest" (FR-017) and duration filters. `unknown` until `videos.list` establishes it, and for live or upcoming videos, which report a zero length they do not have. **Never defaulted to 0** — that defect shipped once (tasks.md, found after closeout). |
| `publishedAt` | timestamp | YouTube (cached) | Needed by date filters (FR-015). |
| `hasCaptions` | boolean \| `unknown` | YouTube (cached) | **Three-valued.** `unknown` until determined — FR-010 must say "I don't know yet", never assume `false` (IMMUNE-U). |
| `chapters` | Chapter[] \| `unknown` | YouTube (cached) | Same three-valued rule. Drives FR-012; absence is a stated outcome, not a failure. |
| `cachedAt` | timestamp | this system | Staleness for the R2 cache. |
| `label` | string \| null | **person** | Personal display name (FR-024). Never sent to YouTube (FR-025). |
| `tags` | string[] | **person** | |
| `lastPositionSeconds` | number | this system | FR-040 resume. |
| `availability` | enum | this system | `available` \| `removed` \| `private` \| `age_restricted` \| `region_blocked` \| `embedding_disallowed` \| `unknown`. Set from IFrame error codes (R4). Drives FR-036. |

**Validation**
- `videoId` matches YouTube's ID format; rejected otherwise rather than stored speculatively.
- `label` is non-empty when present — clearing a label sets `null`, never `""`.
- `durationSeconds` ≥ 0.
- `availability` is never inferred from a failed fetch; an unfetched reference is `unknown`.

---

## Collection

| Field | Type | Notes |
|---|---|---|
| `collectionId` | string | Identity. |
| `name` | string | Unique, case-insensitive. Creating a duplicate is a refusal, not a silent merge. |
| `videoIds` | string[] | Ordered. A video may appear in several collections but only once per collection. |
| `createdAt` | timestamp | |

**Validation**: `name` non-empty; adding a `videoId` already present is a no-op that **reports** it
rather than silently duplicating (IMMUNE-U).

---

## Queue

| Field | Type | Notes |
|---|---|---|
| `items` | string[] | Ordered `videoId`s scheduled after the current one. |
| `currentVideoId` | string \| null | |

A video may legitimately appear twice in a queue (watch it again) — unlike a collection. Clearing is a
bulk action and crosses FR-027's five-reference threshold.

---

## PlaybackSession

| Field | Type | Notes |
|---|---|---|
| `videoId` | string \| null | |
| `positionSeconds` | number | |
| `playerState` | enum | `unstarted` \| `ended` \| `playing` \| `paused` \| `buffering` \| `cued`. Mirrors IFrame states. |
| `playbackRate` | number | The rate **actually in effect**, read back after setting (FR-008, R4). |
| `volume` | integer 0–100 | Read back after setting; a refused change is reported (FR-009). |
| `muted` | boolean | |
| `captionsEnabled` | boolean \| `unsupported` | `unsupported` where the player will not expose caption control (R4). |
| `adPlaying` | boolean | Gates commands the player refuses during ads (FR-014). |

Not persisted except `positionSeconds`, which writes back to the reference (FR-040).

---

## Command

One instruction from the person, and what became of it.

| Field | Type | Notes |
|---|---|---|
| `commandId` | string | Identity. |
| `modality` | enum | `voice` \| `text` (FR-001). |
| `rawText` | string | The recognized or typed text. **No audio is stored** (FR-043). |
| `interpretation` | string | What the system understood, shown to the person (FR-003). |
| `route` | enum | `local_matcher` \| `agent` \| `manual` — which path handled it (R3). |
| `receivedAt` | timestamp | When it was issued. |
| `issueSeq` | integer | Monotonic across every modality, assigned when the command is **issued** — at release of the talk control, not when its transcript arrives. The ordering key for FR-038 (R7). |
| `outcome` | enum | `applied` \| `partially_applied` \| `refused` \| `cancelled` \| `awaiting_confirmation`. |
| `revoked` | boolean | Set when cancelled, **before** remote cancellation is sent. A revoked command's late calls are refused whatever the fence says (R7). |
| `refusalReason` | string \| null | Required and non-empty whenever `outcome` is `refused` (FR-034, SC-009). Carries why an unfinished turn stopped when its outcome is `partially_applied`. |

**State transitions**: `received → interpreted → (awaiting_confirmation →) applied | partially_applied
| refused | cancelled`. There is no terminal state without either an outcome or a reason — the schema
makes a silent failure unrepresentable.

**An assistant command's outcome comes from its tool results**, not from the turn's stream ending
normally: all applied (or none called) → `applied`; some refused → `partially_applied`; all refused →
`refused`. A turn that did **not** finish — stopped at the step limit, failed, or cancelled — after any
action applied is `partially_applied`, with why it stopped as `refusalReason`; with nothing applied it
is `refused`, or `cancelled` (Phase 12 Gate C).

---

## CommandDomain

Not stored; a closed vocabulary. Every tool declares the **set** of domains its effects touch
(FR-038, R7), and is fenced against all of them at once.

| Value | Tools |
|---|---|
| `playback` | `playback.*` |
| `queue` | `queue.*`, and also `playback.next` / `playback.previous`, which advance the queue |
| `catalog_curation` | `catalog.*`, `curation.*` |
| per entry | `activity.undo` is fenced by the domains of the entry it reverses; read-only `activity.*` tools touch none |

A mutating tool declaring no domain is refused at declaration, never treated as touching none — an
undeclared tool would bypass FR-038 silently.

## DomainFence

Page-owned, in memory.

| Field | Type | Notes |
|---|---|---|
| `domain` | `CommandDomain` | |
| `lastAppliedIssueSeq` | integer | Raised only by an effect that applied. A refusal or failure leaves it; a partial effect raises it for what applied. |

**Rule**: an action applies only if its command's `issueSeq` ≥ the fence of every domain it touches,
checked at the moment of application and indivisibly with the effect — never only at handler entry.

---

## AssistantTurn

One command handed to the assistant, from the local acknowledgement to its end. Held by the page for
display; the backend holds only the in-flight request.

| Field | Type | Notes |
|---|---|---|
| `turnId` | string | Identity. |
| `commandId` | string | The `Command` it serves (route `agent`). |
| `issueSeq` | integer | Copied from the command. |
| `state` | enum | `acknowledged` \| `running` \| `late` \| `done` \| `refused` \| `cancelled` |
| `acknowledgedAt` | timestamp | Set locally, before any network call (R9, SC-001/SC-012). |
| `lateAt` | timestamp \| null | Ten seconds after `acknowledgedAt` if not finished. |
| `toolCalls` | `{ toolName, result }`[] | Each also has its own `ActivityRecord` entry; this is the turn's view of them. |
| `refusalReason` | string \| null | Required when `state` is `refused` — including `assistant_allowance_spent` and `assistant_unavailable`. |

**State transitions**: `acknowledged → running → (late →) done | refused | cancelled`, and
`acknowledged → refused` when the allowance or connection refuses before the turn starts. `late` is
not terminal: a late turn still finishes, refuses or is cancelled. There is no terminal state without an
outcome — the same rule `Command` follows.

---

## AssistantAllowance

Backend-owned (FR-046, R8), shaped like `QuotaState`.

| Field | Type | Notes |
|---|---|---|
| `sessionTurnsRemaining` | integer \| `unknown` | Of the per-session limit (default 40). |
| `dayTurnsRemaining` | integer \| `unknown` | Of the deployment-wide daily limit (default 400). `unknown` until established, like `searchCallsRemaining`. |
| `resetsAt` | timestamp | The same Pacific midnight the search budget uses — one notion of "a day" in the product. |

## AssistantSession

Backend-owned, anonymous (FR-042).

| Field | Type | Notes |
|---|---|---|
| `sessionId` | opaque string | Carried in an `HttpOnly`, `SameSite=Strict` cookie set by `POST /api/mcp-ticket`. |
| `connections` | one MCP socket per tab | Bound when a ticket minted for this session and tab is redeemed at the upgrade. A turn names its tab; one with no connection for that tab is refused `assistant_unavailable`. |
| `turnsUsed` | integer | Counted when a turn is admitted, not when it succeeds. |

A tab identifier, if the page sends one, is routing metadata and never admits anything (R8).

---

## ActivityRecord

The evidence surface. This entity is IMMUNE-E made concrete, and FR-029 to FR-033 are its contract.

| Field | Type | Notes |
|---|---|---|
| `entryId` | string | Identity. |
| `commandId` | string | The command that caused it. |
| `toolName` | string | Which declared tool ran. |
| `arguments` | object | What it was called with. |
| `description` | string | Plain language, in the interface's own vocabulary (FR-029). |
| `at` | timestamp | |
| `result` | enum | `succeeded` \| `failed` \| `partially_applied`. |
| `failureDetail` | string \| null | What was applied and what was not (FR-032). Required when not `succeeded`. |
| `inverse` | object \| null | What undoing costs. `null` means not reversible. |
| `undoState` | enum | `undoable` \| `undone` \| `superseded` \| `not_reversible` |
| `supersededBy` | string \| null | The later entry that made this un-undoable (FR-044). |

**Rules**
- Every tool invocation writes exactly one entry — including refusals and failures (SC-006).
- `undoState` is computed, never guessed: an entry is `superseded` only when a specific later entry is
  named. FR-044's "must not offer an undo it cannot perform" is enforced here rather than in the UI.
- An undo writes its **own** entry (FR-031), referencing the entry it reversed.

---

## QuotaState

Not in the spec's entity list, but required by FR-022 and forced by R2.

| Field | Type | Notes |
|---|---|---|
| `searchCallsRemaining` | integer \| `unknown` | Of the 100/day, application-wide. |
| `resetsAt` | timestamp \| `unknown` | |
| `lastKnownAt` | timestamp | |

`unknown` is a first-class value: the page must be able to say "I don't know how much is left"
rather than display a confident zero (IMMUNE-U).

---

## Relationships

```text
Collection ──< videoIds >── VideoReference ──< videoId >── Queue.items
                                  │
                                  └── lastPositionSeconds ←── PlaybackSession

Command ──1:N──> ActivityRecord ──> (inverse) ──> undo writes a new ActivityRecord
```

## Persistence

| Store | Persisted | Why |
|---|---|---|
| `videoReferences` | yes | FR-039, FR-040 |
| `collections` | yes | FR-039 |
| `queue` | session only | Not required to survive a reload |
| `commands` | yes, clearable | FR-041 — the person can clear this history |
| `assistantTurns` | session only | Display of in-flight and recent turns; the durable evidence is the activity record |
| `activityRecords` | yes, at least the session | FR-044 |
| `quotaState` | yes | Survives reload so the page can report quota before its first search |
