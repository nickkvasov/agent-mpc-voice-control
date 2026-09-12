# Engineering constitution

The portable half of a constitution: **how work is done**, with nothing in it about what any
particular system is. Installed by `/kaliper:init` and cited by `kaliper:phased-implement`.

A project's own principles — what *this* system must be — belong in `.specify/memory/constitution.md`
and are written with `/speckit-constitution`. This file does not compete with that one and MUST NOT
be merged into it: two copies of one rule is the thing IMMUNE-N forbids. If the project constitution
already carries these six, delete this file and cite that one instead.

**Citation.** Use the `IMMUNE-` prefix throughout. `I` and `M` are valid Roman numerals, so a bare
"Principle I" reads as a numbered project principle and a bare "Principle M" reads as 1000. The two
Ms are `IMMUNE-M1` (Mutations) and `IMMUNE-M2` (Meta).

| | |
|---|---|
| **IMMUNE-I** | Intent before implementation — if deleting a file loses knowledge the docs and tests do not hold, the requirement was never captured |
| **IMMUNE-M1** | Mutations preserve coherence — a concept has projections in code, schema, public types, docs, tests, the example app; a change is done when they agree again |
| **IMMUNE-M2** | Meta over patch — fix the mechanism that produces a class of errors, without inventing an abstraction for a single typo |
| **IMMUNE-U** | Unexpected states fail loud — unknown is acceptable, hidden unknown is not; no swallowed errors, no convenience defaults |
| **IMMUNE-N** | No duplicated authority, no indispensable parts — one owner per truth, everything else derived; extend by adding owners, not editing old ones |
| **IMMUNE-E** | Every state is explainable — reconstructable from evidence, including what was *not* verified |

---

## Engineering Principles (IMMUNE)

Principles I–XVI say what this system MUST be. These six say how work on it is done. They are
cross-cutting: every numbered principle above is an instance of one or more of them, and where a
numbered principle is more specific it governs its own subject.

**Citation.** Use the `IMMUNE-` prefix. `I` and `M` are valid Roman numerals, so a bare "Principle I"
already means One Concern Per Directory and a bare "Principle M" reads as 1000. The two Ms are
`IMMUNE-M1` (Mutations) and `IMMUNE-M2` (Meta).

### IMMUNE-I. Intent Before Implementation

Requirements matter more than architecture; architecture matters more than implementation.

- A requirement MUST be captured explicitly and testably, in a place that is not the code.
- The control question, applied to any file: **what breaks if you delete it and ask an agent to
  rewrite it from the docs and the tests?** If the answer is "everything", the knowledge lived in the
  code rather than in the requirements, and the requirements are the defect.
- A module that satisfies a captured requirement MAY be deleted and regenerated. That is the test of
  whether the requirement was really captured.

*Rationale:* code is the cheapest artifact to reproduce and the most expensive to interrogate. When
intent lives only in an implementation, every change becomes archaeology, and no agent — human or
otherwise — can regenerate what was never written down.

### IMMUNE-M1. Mutations Preserve Coherence

You are not changing a file; you are changing a **concept** that has many projections: code, schema,
public type, documentation, tests, the example application.

- A change is complete only when every projection of the changed concept tells the same truth again.
- A projection left stale MUST be treated as part of the same defect, not as follow-up work.
- Principle XIV is this rule applied to committed documentation; Principle X is it applied to closed
  vocabularies. Where they are silent, this governs.

*Rationale:* the failure is silent by construction. Nothing type-checks the agreement between a
comment and the code beneath it, or between a tool's declared schema and the handler that ignores a
field, so the only thing that keeps them aligned is treating them as one change.

### IMMUNE-M2. Meta Over Patch

Improve the generator of the result, not only the result.

- On finding a **class** of error, the fix SHOULD address the mechanism that produces it.
- Optimize for compounding returns rather than immediate speed.
- **Bounded deliberately:** one typo is not a reason to build a handler factory. The threshold is a
  demonstrated class — two or more instances, or a mechanism that will keep producing them — not an
  imagined one. Below that threshold, fix the instance; Proportionate Engineering governs, and a
  speculative abstraction is still a violation.

*Rationale:* the same defect found twice is a statement about the process, not about the code. Acting
on the instance and not the mechanism guarantees a third.

### IMMUNE-U. Unexpected States Fail Loud (NON-NEGOTIABLE)

In an unexpected state the system MUST stop, or explicitly surface the uncertainty. It MUST NOT guess
a convenient answer.

- Unknown is an acceptable state. **Hidden unknown is not.**
- MUST NOT swallow an error to keep a code path alive. No sprawling `try`/`catch` stacks, no default
  that silently substitutes for a value the system failed to determine.
- A refusal MUST name what was not established and what it would take to establish it — which is why
  the stale-reference error tells the agent to request a new snapshot rather than returning nothing.
- Where an authorization or permission decision cannot be computed, the system MUST deny rather than
  admit.
- A handler that throws MUST surface as a typed failure on the interface it was called through,
  never as an uncaught exception the host discovers as a crash.

*Rationale:* this system's characteristic defect is the silent success — the tool returns
`{ success: true }`, the agent proceeds, and the application never changed. Every convenience default
is a place where that failure is manufactured on purpose.

### IMMUNE-N. No Duplicated Authority, No Indispensable Parts

Every truth has exactly one owner; every decision belongs to exactly one module. Everywhere else
either references that owner or is generated from it.

- Two components MUST NOT both be authoritative for one fact. A copy is a projection and MUST be
  derived, never maintained in parallel.
- A component that owns exactly one thing, whose authority nobody duplicates, can be deleted and
  replaced without taking the system with it: **an individual is born disposable; the population
  survives.** Every adapter and every integration point is written to that standard deliberately.
- The Open–Closed Principle is this rule applied over time: extend by adding new owners, not by
  modifying existing ones.
- Principle I is this rule applied to directories; Principle X applies it to closed literal sets;
  Principle II applies it to application state. This governs everywhere else.

*Rationale:* a single source of truth is what makes a component safe to regenerate — and what lets an
agent act without first reconstructing which of several copies is currently correct.

### IMMUNE-E. Every State Is Explainable

Every important state MUST be reconstructable from persisted evidence: what happened, why it
happened, what was verified, and **what was not**.

- Evidence MUST record the negative as well as the positive. A verification that did not run is a
  fact about the state.
- Authority MUST be distinguished from evidence about it. Where the two can disagree, the
  authoritative one MUST be named — as Principle II names the application's store as truth and a
  tool's returned payload as evidence about it.
- The observability surface MUST make a call explainable after the fact: which entry point, with what
  input, admitted or denied by which gate, and what the application then did.
- If the system cannot explain a state, it does not know that state, and MUST say so rather than
  present it as settled.

*Rationale:* an unexplainable state is indistinguishable from a wrong one, and neither an operator
nor an agent can act on it without guessing — which IMMUNE-U forbids.

---

## Working practice

These follow from the six above and are the form they take in day-to-day work. They are what
`kaliper:phased-implement` enforces at a phase boundary.

### The health gate is mandatory, and it is the floor

- Every change runs the project's gate commands. `.claude/kaliper/phased-implement/gates.json` is the
  authority on what those are; a gate it does not name is UNCONFIGURED and MUST be reported as NOT
  RUN rather than guessed at. A gate that runs an inferred command reports PASS and means nothing.
- **A green gate is not evidence.** Suites assert what somebody thought to assert. A change is proven
  by driving it the way a person does, in a real browser or a real run, and `NOTES.md` is where each
  incident that proves this gets written down.

### Break it to prove it

When a change adds a gate, a policy branch, a redaction rule or a lifecycle guarantee: delete the
check, confirm the case goes **RED**, restore it, and record that in the change. A suite that stays
green without the check was never testing it. Watch for the assertion that cannot fail — a substring
match where an exact one was meant will pass a break-it attempt while proving nothing.

### Fix the defect, never work around it

- No retry, sleep, tolerance or widened wait to mask a race. No weakened assertion. No disabling or
  deleting a failing test to go green.
- Establish the cause from the code — read it, reproduce it, instrument it, inspect the real traffic
  or the real store. If the cause is not established, or the fix needs a decision the spec does not
  settle, **stop and escalate with the evidence** rather than guessing (IMMUNE-U).

### Named vocabularies for literal values

A closed set of values — error codes, states, levels, capability names — is ONE exported `as const`
dictionary with the type and the membership test derived from it. Never a hardcoded literal, never an
`as`-cast of a received string onto a type that does not admit it. Validate at every boundary the
value crosses.

### Forward-only documentation

Documentation describes current behaviour. An outdated comment is worse than no comment. A comment
naming a PR, issue or ticket instead of describing behaviour is not a comment. Where a change alters
a concept, every projection of it moves in the same change (IMMUNE-M1).

### Proportionate engineering

- The simplest design that satisfies the requirement. No speculative abstraction, cache or config
  knob ahead of demonstrated need.
- Research precedes building: check repo precedent and established libraries first, and name the
  rejected alternative in the plan.
- Non-goals are binding scope limits, not preferences.

### One branch per feature spec

A spec gets its own branch, cut from the default branch. Chaining a spec onto another unlanded
feature branch is legal only when the new work genuinely depends on it, and the dependency is named
in the plan. Stage files by name; never `git add -A` or `git add .`, and never skip pre-commit hooks
without an explicit instruction.
