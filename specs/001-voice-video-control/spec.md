# Feature Specification: Agentic Voice and Text Control of a Video Library

**Feature Branch**: `001-voice-video-control`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "crete a system where user can manage videos and playback from agentic voice and text interations based on https://github.com/A-Launch/agent-mcp-react"

## Overview

A person watching or browsing YouTube through this application can say or type what they want — "skip
to where she starts the demo", "queue the three shortest talks from that channel", "take this out of my
watch-later" — and the application does it. The assistant is a **second way to drive the same
application**, not a separate product bolted on top: every action it takes is an action the visible
interface can also perform, and the result is visible in that interface the instant it happens.

The person keeps the pointer and the keyboard. They can take over mid-sentence, correct the assistant,
or ignore it entirely and click. Nothing the assistant does is hidden from them, and nothing
irreversible happens without their word.

The videos are YouTube's. This application never holds the media: it controls playback within YouTube's
player and curates **references** to videos — collections, tags, labels that belong to the person and
live here. That distinction runs through the whole specification, and it is what makes "delete" a safe
word.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Control playback by speaking or typing (Priority: P1)

A person is watching a video. Holding the talk control, they say "pause", "back fifteen seconds", "one
and a half speed", "turn on captions", or "jump to the part about pricing". The video responds, and the
on-screen controls show the new state — the scrubber moves, the speed indicator changes — exactly as if
they had clicked.

**Why this priority**: This is the smallest slice that delivers the core promise on its own. A person
whose hands are busy, or who is across the room, gets real value from this alone with no collections,
no queueing and no search. It is also the slice that proves the central architectural claim: the
assistant drives the same actions the interface does, and state stays in one place.

**Independent Test**: Load a single known video, issue each playback command by voice and again by
text, and confirm the player reaches the requested state and the visible controls agree with it.
Requires no catalog or curation features whatsoever.

**Acceptance Scenarios**:

1. **Given** a video is playing, **When** the person says "pause", **Then** playback stops within one
   second and the control shows the paused state.
2. **Given** a video is paused at 00:30, **When** the person types "skip forward two minutes", **Then**
   playback position becomes 02:30 and the scrubber reflects it.
3. **Given** a video is playing at normal speed, **When** the person says "speed it up a bit", **Then**
   the system applies a faster playback rate and states which rate it chose.
4. **Given** a video with captions available, **When** the person says "turn on subtitles", **Then**
   captions appear and the caption control shows as active.
5. **Given** a video that offers no captions, **When** the person asks for subtitles, **Then** the
   system says none are available for this video rather than appearing to succeed.
6. **Given** nothing is currently playing, **When** the person says "pause", **Then** the system says
   there is nothing playing rather than failing silently.
7. **Given** a video that publishes chapters, **When** the person says "jump to the part about
   pricing", **Then** playback moves to the chapter whose title best matches and the system names the
   chapter it chose.
8. **Given** a video with no chapters, **When** the person asks to jump to a described moment, **Then**
   the system says it cannot locate that point and offers to seek by timestamp instead.
9. **Given** an advertisement is playing, **When** the person issues a playback command the external
   player will not accept during an ad, **Then** the system says so and offers to apply it once the ad
   ends.

---

### User Story 2 - Find and queue videos conversationally (Priority: P2)

A person describes what they want to watch rather than searching for it: "find talks about state
machines from this year", "just the ones under ten minutes", "play the second one", "queue the rest
after it". Results appear, the queue fills, and the person can see both change as it happens.

**Why this priority**: Discovery is where conversation beats clicking by the widest margin — a search
plus two filters takes four words. It depends on catalog access but not on any curation capability, so
it ships as a complete second slice.

**Independent Test**: With catalog access and no curation features enabled, issue a series of narrowing
requests and confirm the visible result set matches the stated criteria at each step, and that queued
items appear in the queue in the stated order.

**Acceptance Scenarios**:

1. **Given** catalog access, **When** the person says "find talks about state machines from this year",
   **Then** the visible results match both the topic and the date range, and the system states the
   criteria it applied.
2. **Given** results are shown, **When** the person says "only the short ones", **Then** the filter
   narrows within the current result set rather than starting a fresh search.
3. **Given** a list of results is visible, **When** the person says "play the third one", **Then** that
   video begins playing and the rest of the list is left untouched.
4. **Given** a video is playing, **When** the person says "queue these up next", **Then** the named
   videos are appended to the queue in the order discussed and the queue is visible.
5. **Given** a request matches nothing, **When** the person asks for it, **Then** the system says so
   and states which criteria it applied, rather than showing an empty list with no explanation.
6. **Given** a request is ambiguous ("play the one about launches"), **When** two or more results
   match, **Then** the system presents the candidates and asks which, rather than guessing.
7. **Given** a queued video has become unavailable, **When** the queue reaches it, **Then** the system
   says why it was skipped and continues to the next item.

---

### User Story 3 - See and undo what the assistant did (Priority: P3)

Every action the assistant takes appears in a visible, plain-language record: what it did, to what, and
when. If it did the wrong thing — filtered too aggressively, queued the wrong talk, removed the wrong
video from a collection — the person can undo it from that record without hunting for the original
state.

**Why this priority**: A conversational interface guesses, and it will sometimes guess wrong. Without a
legible record and a way back, a wrong guess is indistinguishable from a bug and erodes trust in every
subsequent action. This is the slice that makes the others safe to rely on, which is why it ranks above
curation.

**Independent Test**: Issue a sequence of commands, then confirm each one appears in the record with an
accurate description, and that undoing any reversible entry returns the application to its prior state.

**Acceptance Scenarios**:

1. **Given** the assistant has changed a filter, **When** the person opens the activity record,
   **Then** they see what changed, expressed in the same terms the interface uses.
2. **Given** the assistant performed a reversible action, **When** the person chooses undo on that
   entry, **Then** the prior state is restored and the undo is itself recorded.
3. **Given** the person asks "what did you just do?", **When** the system answers, **Then** the answer
   matches the activity record exactly.
4. **Given** an action failed partway, **When** the person inspects the record, **Then** the entry
   states plainly that it failed and what was and was not applied.

---

### User Story 4 - Curate collections by conversation (Priority: P4)

A person organizes what they have found, without a mouse: "tag these three as onboarding", "label this
one Q3 retro", "make a collection called Favorites and put these in it", "take the duplicate out of
that collection". Requests that discard the person's own curation are confirmed before they run.

**Why this priority**: Genuinely useful, but it is the slice a person can most easily do by hand, and
it carries the highest cost when the assistant misunderstands. It ships last, on top of the record and
undo capability from P3.

**Independent Test**: Issue create, label, tag and remove requests and confirm each is applied to
exactly the intended references, and that every discarding request halts for confirmation first.

**Acceptance Scenarios**:

1. **Given** several videos are selected or referenced, **When** the person says "tag these as
   onboarding", **Then** that tag is applied to exactly those references and to no others.
2. **Given** a video the person did not publish, **When** they say "call this one Q3 retro", **Then**
   the system applies a personal label visible only here, and says that the video's own title is
   unchanged.
3. **Given** the person asks to remove a video from a collection, **When** the request is understood,
   **Then** the system names the specific video and collection and waits for explicit confirmation.
4. **Given** a confirmation prompt is open, **When** the person says anything other than a clear
   confirmation, **Then** the action is abandoned rather than proceeding.
5. **Given** the person asks to empty a collection, **When** it holds more references than a stated
   safety threshold, **Then** the system states the count and requires confirmation naming that count.

---

### Edge Cases

- **Speech is misrecognized into a valid but different command.** "Play the next one" heard as "remove
  the next one" must not silently discard curation — discarding intent always confirms first, naming
  its target.
- **A reference cannot be resolved.** "Play that one" with nothing selected and no recent context: the
  system asks rather than picking.
- **Two commands arrive at once.** The person speaks a second command while the first is still being
  applied; the system must apply them in the order spoken or refuse the second explicitly.
- **The person acts manually mid-command.** They click pause while the assistant is seeking; the manual
  action wins and the assistant reports what it abandoned.
- **The requested capability is not on screen.** The person asks to change something belonging to a
  view they have not opened; the system states that rather than failing silently or acting on a stale
  view.
- **A video is unavailable.** Private, removed, age-restricted, region-blocked, or not embeddable: each
  is reported with its specific reason, never as a generic failure.
- **An advertisement is playing.** Commands the external player refuses during an ad are reported as
  deferred or refused, never accepted and dropped.
- **Catalog access is rate-limited or exhausted for the day.** Search degrades with a stated reason;
  already-loaded results, the queue and playback all stay usable.
- **The talk control is released mid-sentence.** The partial utterance is shown and not acted on unless
  it is unambiguously complete.
- **The microphone is denied or unavailable.** Voice degrades to text with a visible explanation; no
  capability silently disappears.
- **The assistant's connection drops mid-session.** Commands issued while disconnected are refused with
  a clear reason; the visible interface remains fully usable by hand throughout.
- **Volume control is refused by the platform.** On devices where the player forbids programmatic
  volume changes, the system says so rather than reporting a change that did not happen.
- **A result set is very large.** "Queue everything" reports the count and confirms before proceeding.
- **Ambiguous time references.** "Go back a bit" with no established meaning: the system applies a
  stated default and says what it applied, so the person can correct it.

## Requirements *(mandatory)*

### Functional Requirements

#### Command input

- **FR-001**: Users MUST be able to issue commands by speech and by typed text, with both producing
  identical results for an equivalent instruction.
- **FR-002**: System MUST capture audio only while the person is actively holding or has toggled on an
  explicit talk control, MUST show unambiguously while it is capturing, and MUST NOT listen for a wake
  word in this release.
- **FR-003**: System MUST display its interpretation of a spoken command before or as it acts, so a
  misrecognition is visible to the person.
- **FR-004**: Users MUST be able to cancel an in-flight command before it takes effect.
- **FR-005**: System MUST remain fully operable by hand — every action available by voice or text MUST
  also be reachable through the visible interface.

#### Playback control

- **FR-006**: Users MUST be able to start, pause, resume and stop playback by command.
- **FR-007**: Users MUST be able to seek to an absolute position and by a relative amount by command.
- **FR-008**: Users MUST be able to change playback speed by command, and the system MUST state the
  resulting speed.
- **FR-009**: Users MUST be able to change volume and mute state by command, and the system MUST report
  when the platform refuses such a change rather than reporting success.
- **FR-010**: Users MUST be able to enable and disable captions, and select among the caption tracks
  the video offers, by command.
- **FR-011**: Users MUST be able to move to the next and previous item in the queue by command.
- **FR-012**: Users MUST be able to seek to a published chapter by describing it, and the system MUST
  name the chapter it resolved to.
- **FR-013**: System MUST reflect every command-driven playback change in the visible player controls
  within one second of applying it.
- **FR-014**: System MUST report, rather than silently drop, any playback command the external player
  refuses — including during advertisements.

#### Discovery and queue

- **FR-015**: Users MUST be able to search the catalog by command, and to filter results by the
  attributes the visible interface exposes.
- **FR-016**: System MUST apply successive narrowing requests to the current result set, and MUST state
  when it has instead started a fresh search.
- **FR-017**: Users MUST be able to refer to results positionally ("the third one") and by attribute
  ("the shortest"), with the system stating which item it resolved to.
- **FR-018**: System MUST ask the person to choose when a reference matches more than one item, rather
  than selecting one.
- **FR-019**: Users MUST be able to add items to the queue, reorder it, remove items from it and clear
  it by command.
- **FR-020**: System MUST make the current queue visible whenever it changes.
- **FR-021**: System MUST state the criteria it applied whenever it presents or narrows a result set.
- **FR-022**: System MUST report when catalog access is unavailable, rate-limited or exhausted, and
  MUST keep already-loaded results, the queue and playback usable when it is.

#### Curation

- **FR-023**: Users MUST be able to create collections, add references to them and remove references
  from them by command.
- **FR-024**: Users MUST be able to apply and remove tags, and to set a personal label on a video, by
  command.
- **FR-025**: System MUST make clear that labels and tags are the person's own and do not alter the
  video at its source.
- **FR-026**: System MUST require explicit confirmation, naming the specific target, before discarding
  any curation the person created.
- **FR-027**: System MUST state the affected reference count and require confirmation of that count
  before any action affecting more references than a defined bulk threshold.
- **FR-028**: System MUST treat an unclear response to a confirmation prompt as a refusal.

#### Transparency and recovery

- **FR-029**: System MUST record every action the assistant takes, with what it did, to which items,
  and when, described in the same vocabulary the visible interface uses.
- **FR-030**: Users MUST be able to undo any reversible recorded action and have that prior state
  restored.
- **FR-031**: System MUST record undo actions themselves.
- **FR-032**: System MUST state plainly when an action failed, including what was applied and what was
  not — a partially applied action MUST NOT be recorded as a success.
- **FR-033**: System MUST answer a direct question about its recent actions consistently with the
  recorded history.

#### Failure behavior

- **FR-034**: System MUST refuse any command it cannot carry out, stating the reason, and MUST NOT
  substitute an approximate action for the one requested without saying so.
- **FR-035**: System MUST report when a requested capability is unavailable because the relevant part
  of the interface is not currently open, rather than acting on stale information.
- **FR-036**: System MUST distinguish and report the specific reason a video cannot be played —
  removed, private, age-restricted, region-blocked, or not embeddable.
- **FR-037**: System MUST keep the visible interface fully usable when the assistant is unavailable or
  disconnected, and MUST show that the assistant is unavailable.
- **FR-038**: System MUST apply commands in the order issued, or explicitly refuse one that would be
  applied out of order.

#### Data handling

- **FR-039**: System MUST persist the person's curation — collections, tags, labels — across sessions.
- **FR-040**: System MUST persist playback position per video so a resumed video continues where it
  stopped.
- **FR-041**: System MUST make visible what it retains of voice recordings and command transcripts, and
  MUST allow the person to clear that history.

### Key Entities

- **Video Reference**: A pointer to a video in the external catalog, together with what this system
  knows about it — title, channel, duration, publication date, caption and chapter availability. The
  media itself is never held here.
- **Collection**: A named, person-created grouping of video references. A reference may belong to
  several.
- **Tag / Label**: Person-authored annotations on a reference. A label is a personal display name; it
  never changes the video at its source.
- **Queue**: The ordered list of references scheduled to play after the current one.
- **Playback Session**: The current video, position, speed, volume, mute and caption state.
- **Command**: One instruction from the person — its spoken or typed form, the system's interpretation
  of it, and its outcome.
- **Activity Record**: The ordered history of actions the assistant took, each linked to the command
  that caused it, whether it succeeded, and whether it can be undone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can pause, seek, change speed and toggle captions entirely by voice, with the
  result visible within one second of the command being understood.
- **SC-002**: 95% of playback commands spoken in a quiet room by a fluent speaker are carried out
  correctly on the first attempt.
- **SC-003**: A person can locate and start a specific video by description alone, without touching a
  control, in under 20 seconds.
- **SC-004**: Building a five-item queue by conversation takes less than half the time of building the
  same queue by hand.
- **SC-005**: 100% of actions that discard the person's curation are preceded by a confirmation naming
  the specific target; none is ever carried out on an unclear response.
- **SC-006**: Every action the assistant takes appears in the activity record — no action is
  unaccounted for.
- **SC-007**: A person shown the activity record can correctly state what the assistant did, without
  further explanation, in 90% of cases.
- **SC-008**: Any reversible action can be undone in a single interaction from the activity record.
- **SC-009**: Every refused or failed command produces a stated reason; no command fails silently.
- **SC-010**: With the assistant disconnected, every task in this specification remains completable by
  hand.
- **SC-011**: No audio is captured at any moment when the interface does not show that it is capturing.

## Assumptions

- **The application owns its state, and the assistant is a second control interface onto it.** The
  assistant calls the same actions the visible interface calls; it does not maintain a parallel copy of
  curation or playback state. This follows from the chosen foundation (see Dependencies) and is why
  manual and conversational control can be used interchangeably.
- **Single person per session.** Multi-user accounts, sharing and permissions are out of scope. One
  person, one set of collections, one session at a time.
- **The person's curation is local to this application.** Collections, tags and labels created here are
  not written back to the external catalog, and the person's existing playlists there are not modified
  by this feature.
- **Seeking by described content relies on chapters the video already publishes.** Deriving chapter
  points from audio or transcript is out of scope; where no chapters exist the system says so.
- **Confirmation is required by default** for anything that discards curation, rather than configurable
  off in this release.
- **English-language commands for the first release.** Additional languages are out of scope here.
- **Playback happens on the person's own device in the application's interface.** Casting to external
  devices is out of scope.
- **Advertisements are outside this system's control.** They are reported, worked around and waited
  out, never suppressed.

## Dependencies

- **`agent-mcp-react`** (https://github.com/A-Launch/agent-mcp-react) is the stated foundation: it
  exposes a running application as a control surface that an agent drives through typed, schema-checked
  actions rather than by manipulating the interface. Two consequences shape this specification rather
  than merely its implementation: actions are available only while the part of the interface that
  declares them is on screen (FR-035), and the application remains the single owner of its state
  (FR-005, SC-010).
- **An agent runtime and a connection to it.** The foundation supplies the in-page half only; the
  service the assistant runs in, and the credential exchange that lets the page reach it, are supplied
  by this project and are a prerequisite for any conversational capability.
- **YouTube, as both catalog and player.** Search and metadata come from its data service; playback
  happens in its player, on its terms. This is a hard external boundary, and several requirements exist
  only because of it: quota and rate limits (FR-022), advertisements (FR-014), availability and
  embedding restrictions (FR-036), and platform refusal of volume changes (FR-009). Its terms of
  service govern what this application may do with the player.
- **A speech recognition capability** for voice input. Text input has no such dependency, which is why
  FR-001 requires both paths to be equivalent — text remains the fallback whenever voice is
  unavailable.

## Clarifications

### Session 2026-09-12

- **Q: Where do the videos come from?** → **A: YouTube.** The system controls playback within YouTube's
  player and curates references to its videos; it never stores or manages the media. "Delete" therefore
  means removing a reference from the person's own collection, never destroying a video — which is why
  FR-026 speaks of discarding curation rather than deleting content, and why User Story 4 is about
  curation rather than library management.
- **Q: Is the microphone always listening, or push-to-talk?** → **A: Push-to-talk for this release,
  with a wake word as a possible opt-in later.** FR-002 requires explicit activation and forbids wake
  word listening in this release; SC-011 makes the absence of silent capture testable. A future wake
  word is deliberately deferred until the confirmation and activity-record machinery of User Story 3
  is proven, since an accidental wake-up acting on a misheard command is exactly the failure that
  record exists to catch.
