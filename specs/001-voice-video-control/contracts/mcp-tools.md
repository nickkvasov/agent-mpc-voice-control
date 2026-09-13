# Contract: The tool surface the page declares

**Feature**: `001-voice-video-control` | **Date**: 2026-09-12, revised 2026-09-13

This is the feature's primary external interface: the typed actions `agent-mcp-react` publishes from
the running page, which the agent calls instead of clicking. It is the **single owner** of what an
action means — the local matcher (R3) and the Claude agent both call these and neither may bypass
them (IMMUNE-N).

## Rules that apply to every tool

1. **Input is schema-checked before the handler runs.** A validator is mandatory in
   `agent-mcp-react`; every schema sets `additionalProperties: false` and lists `required`.
2. **A handler never returns a bare success.** Every result carries `{ ok: true, … }` or
   `{ ok: false, reason, detail }`. A tool that could not do what was asked returns `ok: false` with
   a reason — never `ok: true` with no effect (IMMUNE-U; this is the characteristic defect).
3. **Every invocation writes exactly one activity record**, including refusals (FR-029, SC-006).
4. **Tools exist only while the UI that declares them is on screen.** A call to an absent tool is
   reported as unavailable, naming the view that owns it (FR-035).
5. **Tools that discard curation ask the person inside the handler**, naming the target, before the
   domain is taken (FR-026). Not through `agent-mcp-react`'s `confirmation: 'required'`: that gates only
   the library's bridge — a page script calls the same tool with no dialog — and declaring both would ask
   the assistant path twice. Decided in Phase 9.
6. **Every mutating tool declares the domains it affects** — `playback`, `queue`, `catalog_curation`
   — and is ordered only against those (FR-038, R7). `playback.next`/`previous` declare `playback` and
   `queue`; `activity.undo` takes the domains of the entry it reverses. A mutating tool declaring none is
   refused at declaration. The order check runs **at application**, not at handler entry.
8. **Every tool's input carries the reserved `commandId`**, defined once and added to each schema
   mechanically. It names the page's own command record; an unknown, cancelled, finished or foreign id
   is refused. The assistant never sees or sets it: the backend strips it from the schema shown to the
   model and writes the turn's id into every forwarded call. Local callers get it from the same command
   owner (R7). It is the only attribution on the wire — `issueSeq` never leaves the page.
7. **A mutating playback tool reports what the player confirmed**, awaited for at most one second, never
   what it asked for (R10). No confirmation within the bound is `refused_by_player` with the state the
   player actually reports.

## Shared failure reasons

`not_playing` · `no_such_video` · `ambiguous_reference` · `unavailable_video` ·
`refused_by_player` · `ad_in_progress` · `capability_unsupported` · `quota_exhausted` ·
`view_not_open` · `needs_confirmation` · `not_reversible` · `superseded` · `arguments_invalid` ·
`effect_unverifiable` · **`overtaken_by_newer_command`** (FR-038 — names the newer command) ·
**`autoplay_blocked`** (the browser refused to start playback; a press is needed — R10) ·
**`command_cancelled`** (the call's command was revoked, or its signal aborted, before it applied — FR-004) ·
**`command_finished`** (the call names a command that has already finished; it is never re-attributed — R7) ·
**`unknown_command`** (the call names a command this page never issued — R7)

`assistant_unavailable` and `assistant_allowance_spent` are not tool reasons: they refuse a turn before
any tool runs, and belong to [backend-http.md](./backend-http.md).

---

## Playback — `playback.*`

Domain `playback`. Declared by the player view. These are the tools the local matcher may call (R3).

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `playback.play` | `{}` | state | `not_playing` if nothing cued |
| `playback.playVideo` | `{ videoId }` | `{ videoId, state }` | Loads and plays a specific video — what "play the third one" (FR-017) and a result's Play button both need. Reports `autoplay_blocked`, or the specific unavailability reason (FR-036), rather than "playing". Added Phase 10 |
| `playback.pause` | `{}` | state | |
| `playback.stop` | `{}` | state | |
| `playback.seek` | `{ mode: "absolute" \| "relative", seconds: number }` | state | Clamped to duration; returns the position actually reached |
| `playback.seekToChapter` | `{ query: string }` | `{ chapterTitle, positionSeconds }` | FR-012. `ok: false` + `capability_unsupported` when the video publishes no chapters |
| `playback.setRate` | `{ rate: number }` | `{ rateApplied }` | **Reads back** `getPlaybackRate()`; reports the rate in effect, not the one requested (FR-008) |
| `playback.setVolume` | `{ volume: 0–100 }` | `{ volumeApplied }` | Reads back; `refused_by_player` if unchanged (FR-009) |
| `playback.setMuted` | `{ muted: boolean }` | `{ muted }` | Reads back |
| `playback.setCaptions` | `{ enabled: boolean, track?: string }` | `{ enabled, track }` | `capability_unsupported` is an expected outcome, not an error (R4) |
| `playback.next` / `playback.previous` | `{}` | `{ videoId }` | Skips unavailable items, stating why (FR-036) |
| `playback.getState` | `{}` | `PlaybackSession` | Read-only |

Any of these called while `adPlaying` returns `ok: false, reason: "ad_in_progress"` with
`retryAfterAd: true` (FR-014).

---

## Discovery — `catalog.*`

Domain `catalog_curation`. Declared by the browse view.

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `catalog.search` | `{ query, publishedAfter?, publishedBefore? }` — no `maxResults` until the client and backend honour it (Phase 9) | `{ results[], criteriaApplied, quotaRemaining }` | **Spends quota** (R2). `quota_exhausted` when none left; loaded results stay usable (FR-022) |
| `catalog.narrow` | `{ maxDurationSeconds?, minDurationSeconds?, publishedAfter?, publishedBefore?, titleContains? }` | `{ results[], criteriaApplied, narrowedFrom: "current_results" }` | **Spends no quota.** Operates on the current result set (FR-016). The quota-preservation path |
| `catalog.getCurrentResults` | `{}` | `{ results[], criteriaApplied }` | Read-only |
| `catalog.resolveReference` | `{ reference: string }` | `{ videoId }` or `{ candidates[] }` | "the third one", "the shortest". Returns candidates instead of choosing when ambiguous (FR-018) |
| `catalog.getQuota` | `{}` | `QuotaState` | May return `unknown` |

`criteriaApplied` is required on every result-returning call — FR-021 makes it part of the contract,
not a UI nicety.

---

## Queue — `queue.*`

Domain `queue`.

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `queue.add` | `{ videoIds: string[], position?: "next" \| "end" }` | `{ queue }` | >5 items requires confirmation (FR-027) |
| `queue.remove` | `{ videoIds: string[] }` or `{ entryIds: string[] }` — exactly one | `{ queue }` | By video removes every occurrence; by entry removes exactly that one. The queue may hold a video twice, and its Remove button means one occurrence |
| `queue.reorder` | `{ videoId, toIndex }` | `{ queue }` | |
| `queue.clear` | `{}` | `{ queue }` | `confirmation: 'required'` when the queue holds >5 (FR-027) |
| `queue.get` | `{}` | `{ queue }` | Read-only |

---

## Curation — `curation.*`

Domain `catalog_curation`. All but `curation.getCollections` mutate the person's own data; those are reversible, so they carry an `inverse` for FR-030.

| Tool | Input | Returns | Confirmation |
|---|---|---|---|
| `curation.createCollection` | `{ name }` | `{ collectionId }` | no — duplicate name refuses |
| `curation.addToCollection` | `{ collectionId, videoIds[] }` | `{ collection }` | >5 videos |
| `curation.removeFromCollection` | `{ collectionId, videoIds[] }` | `{ collection }` | **required** (FR-026) |
| `curation.deleteCollection` | `{ collectionId }` | `{ ok }` | **required**, naming the collection and its count |
| `curation.setLabel` | `{ videoId, label: string \| null }` | `{ videoId, label, sourceTitleUnchanged: true }` | no — `sourceTitleUnchanged` is asserted in the result so FR-025 is observable |
| `curation.addTags` / `curation.removeTags` | `{ videoIds[], tags[] }` | `{ updated[] }` | >5 videos |
| `curation.getCollections` | `{}` | `{ collections: { collectionId, name, videoIds[] }[] }` | Read-only, no domain. Added in Phase 13: without it the assistant could name no collection it had not just created, so no removal or deletion by the assistant could find its target |

A tool declaring `confirmation: 'required'` does not run until the resolver returns approval.
An unclear response resolves to **refusal** (FR-028) — the resolver has no "assume yes" path.

A confirmation names videos as the person knows them — their label, else their title, else the id
only when neither is known — and so does the activity record (FR-026, FR-029). A declined or dismissed
confirmation is refused `needs_confirmation` with a detail quoting the question and the answer and
stating that nothing changed, never as a question still waiting (Phase 13 Gate B: the live model read
"…? Confirm to go ahead." as an invitation to confirm again).

---

## Transparency — `activity.*`

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `activity.list` | `{ limit? }` | `{ entries[] }` | FR-029 |
| `activity.undo` | `{ entryId }` | `{ undone, newEntryId }` | `not_reversible` or `superseded` (naming the later entry) rather than a failed attempt (FR-044) |
| `activity.describeRecent` | `{ count? }` | `{ summary }` | Answers "what did you just do?" **from the record**, so FR-033's consistency is structural rather than a prompt instruction |

---

## Capabilities declared to `agent-mcp-react`

```ts
capabilities={{
  application: true,          // the tools above
  dom: { inspect: false, interact: false },   // never — the point is typed actions, not clicking
  evaluate: false,            // never
}}
```

`dom` and `evaluate` stay off permanently. Turning either on would give the agent a second way to
change the application that bypasses the tool contract, the confirmation gates and the activity
record — three requirements defeated at once (FR-005, FR-026, SC-006).
