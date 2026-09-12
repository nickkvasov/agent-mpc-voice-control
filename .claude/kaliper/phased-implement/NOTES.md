# What a green gate has actually cost here

**This file is a stub.** Nobody has written down what this project's suites miss yet, so the live gate
in `kaliper:phased-implement` has no local evidence behind it. The gate still runs — this file is
what makes it persuasive rather than a rule somebody can argue away.

Fill it in the first time a live run finds something a green suite did not. That entry is worth more
than anything written here in advance.

## Sections worth having

- **The gate passed and the browser disagreed.** Each incident: what was green, what the live run
  found, and why no case could see it.
- **Defects a real transport hides.** Timing bugs that disappear under a real round trip, and what to
  assert instead of the outcome.
- **Assertions that could not fail.** Break-it attempts that stayed green because the check matched
  too loosely.
- **Readiness rules.** Anywhere the UI claims ready before the backend can answer.
- **Decisions that go to codex before the code exists.** The modules, dictionaries and contracts whose
  blast radius is wide enough to be worth a second opinion.
