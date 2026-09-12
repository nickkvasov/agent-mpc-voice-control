<!--
SYNC IMPACT REPORT
Version change: none → 1.0.0 (initial ratification; template had no defined principles)
Modified principles: none (first definition)
Added sections:
  - Core Principles I–VII
  - External Boundaries and Privacy
  - Development Workflow and Quality Gates
  - Governance
Removed sections: none
Templates requiring updates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" is generic
     ("Gates determined based on constitution file") and needs no edit; the
     filled plan.md already evaluates these principles by name.
  ✅ .specify/templates/spec-template.md — no new mandatory spec section is
     introduced; Principle VII is satisfied through requirements, not structure.
  ✅ .specify/templates/tasks-template.md — phase categories are principle-neutral;
     the principle-driven task types (contract tests, evidence, break-it-to-prove-it)
     fit the existing Foundational and Polish phases.
  ✅ CLAUDE.md — managed SPECKIT block references the plan, not the constitution.
  n/a .specify/templates/commands/ — directory does not exist in this install
      (this Spec Kit version ships skills, not command templates).
  n/a README.md — none in this project.
Deferred TODOs: none.
-->

# Agentic Voice Video Control Constitution

This constitution states **what this system must be**. It does not restate how work is done: the six
IMMUNE principles in `.claude/kaliper/constitution.md` own that, and are cited here by name rather
than copied. Two copies of one rule is what IMMUNE-N forbids, and that file's own header forbids
merging it into this one. Where a principle below is an instance of an IMMUNE principle, the citation
is given — the specific rule governs its own subject; IMMUNE governs everywhere else.

## Core Principles

### I. The Application Owns Its State

The application is the single owner of every fact about the library, the queue and playback. The
assistant holds no state of its own and maintains no parallel copy.

- Every action the assistant can take MUST be an action the visible interface can also take.
- The assistant MUST NOT be able to reach a state the person cannot reach by hand.
- Conversational and manual control MUST be interchangeable at any moment, mid-task included.

*Rationale:* this is what makes the assistant a second control interface rather than a second
application. The moment the assistant owns state, the two can disagree, and no person or agent can
tell which is correct without guessing. Instance of IMMUNE-N.

### II. One Tool Surface

The typed tools the page declares are the single owner of what an action means. Every actor — the
person clicking, the local command matcher, the language model — goes through them.

- A new capability MUST be added as a declared tool, never as a private path into state.
- DOM manipulation and script evaluation capabilities MUST remain disabled.
- A tool MUST be declared by the component that owns the state it changes, so that a capability is
  unavailable exactly when its part of the interface is not on screen — a consequence of the
  structure, not a check someone has to remember.

*Rationale:* a second way to change the application would bypass the confirmation gates and the
activity record at once, defeating Principles V and VI without any code appearing to change. Instance
of IMMUNE-N.

### III. No Bare Success (NON-NEGOTIABLE)

Every tool call reports either what it did or why it did not. There is no third outcome.

- A handler MUST return a typed failure with a reason; it MUST NOT report success with no effect.
- A refusal MUST name what could not be established and what would establish it.
- An approximate action MUST NOT be substituted for the one requested without saying so.
- No swallowed errors, no convenience default standing in for a value the system failed to determine.

*Rationale:* the characteristic defect of this architecture is the silent success — the tool returns
success, the assistant proceeds, and the application never changed. The person is looking at the
screen, so they see nothing happen and lose trust in the whole interface, not just the one command.
Instance of IMMUNE-U.

### IV. Unknown Is a Value

Where the system does not know something, it MUST be able to say so.

- A fact the system has not established MUST be representable as unknown, distinctly from a known
  negative. Captions availability, chapter availability and remaining quota are unknown until
  determined, never assumed absent.
- An unfetched or failed lookup MUST NOT be recorded as a determination.
- The interface MUST be able to display "not known yet" rather than a confident wrong answer.

*Rationale:* collapsing unknown into false is how a system starts lying without anyone writing a lie.
"This video has no captions" and "I have not checked" are different statements, and only one of them
is safe to act on. Instance of IMMUNE-U.

### V. Every Assistant Action Is Recorded and Reversible

The activity record is the evidence surface, and it is a requirement rather than a feature.

- Every tool invocation MUST write exactly one record entry — refusals and failures included.
- An entry MUST describe what happened in the same vocabulary the interface uses.
- A partially applied action MUST record what was applied and what was not; it MUST NOT be recorded
  as a success.
- Any reversible entry MUST be undoable, not only the most recent one, and an undo MUST record
  itself.
- Where an entry can no longer be undone, the record MUST name the later entry that superseded it,
  and MUST NOT offer an undo it cannot perform.

*Rationale:* a conversational interface guesses, and will sometimes guess wrong. Without a legible
record and a way back, a wrong guess is indistinguishable from a bug. Instance of IMMUNE-E.

### VI. Destruction Confirms, Ambiguity Refuses

Anything that discards what the person created stops and asks first.

- A destructive request MUST name its specific target before proceeding.
- An action affecting more than a defined bulk threshold MUST state the count and require
  confirmation of that count.
- An unclear response to a confirmation MUST resolve to refusal. There is no "assume yes" path.

*Rationale:* speech is misrecognized, and a misrecognition that lands on a valid destructive command
is the failure this system is most able to cause and least able to excuse. Instance of IMMUNE-U
applied to intent rather than state.

### VII. Boundaries Are Stated, Never Implied

What leaves the person's device, and what the system cannot do, are disclosed plainly.

- A privacy boundary MUST be stated rather than inferable: if audio stays local but text does not,
  both halves MUST be said.
- Capture MUST be visible for exactly its duration, and MUST NOT occur outside it.
- A capability the system lacks MUST be reported as absent rather than silently unexercised.
- The system MUST NOT let a true statement about one boundary imply a false statement about another.

*Rationale:* a partial truth about privacy is worse than silence, because it is believed. Stating
that speech is recognized on the device, while omitting that the command text is sent to a language
model service, would be technically accurate and substantively false.

## External Boundaries and Privacy

This system depends on services it does not control, and those limits are designed for rather than
discovered in production.

- **Catalog quota is a daily condition, not an error.** Search access is a small, shared, daily
  allowance. Narrowing an existing result set MUST be preferred over issuing a new search wherever
  the criteria allow it, and exhaustion MUST leave loaded results, the queue and playback usable.
- **The external player's refusals are reported, never masked.** Advertisements, unavailable or
  non-embeddable videos, and platform refusal of volume changes are each reported with their specific
  reason. A requested change MUST be read back and verified rather than assumed applied.
- **Credentials never reach the browser.** API keys for the catalog and the language model service
  live server-side. The page receives only opaque, single-use connection credentials, which it MUST
  NOT parse, amend or store.
- **Audio does not leave the device.** Speech recognition runs locally. Where local recognition is
  unavailable, voice input MUST be refused with a stated reason rather than falling back to remote
  recognition.
- **The hand path never degrades.** With the assistant unavailable, every task this system supports
  MUST remain completable through the visible interface, and its unavailability MUST be shown.
- **The external platform's terms govern playback.** Playback happens in the provider's player, on
  the provider's terms.

## Development Workflow and Quality Gates

Working practice is owned by `.claude/kaliper/constitution.md` and enforced by
`kaliper:phased-implement`. What follows is the part specific to this system.

- **A green suite is not evidence.** Every phase is proven by driving the application in a real
  browser the way a person does. Incidents a green suite missed are recorded in
  `.claude/kaliper/phased-implement/NOTES.md`.
- **Failure behavior is tested first-class.** Refusals, quota exhaustion, unavailable videos,
  disconnection and unsupported capabilities each have explicit coverage. These are where mocked
  tests are least trustworthy and where Principle III is most likely to be violated silently.
- **Every gate a change adds is broken to prove it.** Delete the check, confirm the case goes red,
  restore it, and record that.
- **Closed value sets are named vocabularies.** Error codes, player states, availability reasons,
  refusal reasons and capability names are each one exported dictionary with the type and membership
  test derived from it — never a hardcoded literal, never a cast of a received string.
- **Timing claims are measured where the person experiences them.** Latency budgets are measured from
  the end of the person's utterance, including recognition and round-trip — never from the moment the
  system finished understanding.

## Governance

This constitution supersedes other practice for questions about what this system must be. For
questions about how work is done, `.claude/kaliper/constitution.md` governs and this file defers to
it. Neither file may restate the other's rules; a rule that belongs in both belongs in one of them
and is cited from the other.

**Amendments** require a written rationale, a version bump under the policy below, and the same
change to every artifact that projects the amended rule — plan templates, contracts, and any
requirement that cited it. An amendment that leaves a projection stale is an incomplete amendment,
not follow-up work (IMMUNE-M1).

**Versioning policy** is semantic:

- **MAJOR** — a principle is removed or redefined in a way that invalidates existing compliance.
- **MINOR** — a principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarification, wording, or non-semantic refinement.

**Compliance review** happens at two points. Every plan evaluates its design against these principles
before Phase 0 research and again after Phase 1 design, recording the result in its Constitution
Check. Every phase boundary re-checks them against what was actually built. A violation is either
fixed or recorded in the plan's Complexity Tracking with the simpler alternative that was rejected
and why — never waived silently.

**Version**: 1.0.0 | **Ratified**: 2026-09-12 | **Last Amended**: 2026-09-12
