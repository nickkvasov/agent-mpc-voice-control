# What a green gate has missed here

Evidence for this project. `kaliper:phased-implement` reads this before deciding a live run is
optional — it never is, but this is where the local reasons accumulate.

## Incidents

### 2026-09-12 — the e2e gate asserted against a different application

**What happened.** The first `npm run test:e2e` run failed with a DOM that belonged to the
`agent-mcp-react` demo board, not this project. Playwright's `reuseExistingServer` attached to a
`test-agent-mcp` dev server already listening on Vite's default port 5173 and drove that instead of
starting ours.

**Why it matters more than a red run suggests.** It failed only because the two apps happen to render
different text. Had our shell contained the asserted string, the run would have reported **PASS while
never loading this project's code at all** — a green gate proving nothing, which is the failure this
file exists to record.

**Fixed by** moving the dev server to port 5273 with `strictPort: true` (so a collision fails loudly
rather than drifting to the next free port) and `reuseExistingServer: false`.

**Standing readiness rule.** Before trusting a live run, confirm the server under test is *this*
project's. A responding port is not identity.

### 2026-09-12 — the on-device speech probe crashes headless Chrome

**What happened.** `SpeechRecognition.available({processLocally:true})` kills the renderer in
headless Chrome for Testing 153. Headed chromium and system Chrome both answer `"downloadable"`.

**Why it matters for the gates.** Any e2e coverage that touches voice cannot run headless. A suite
that skips the probe because headless crashed, and reports green on the rest, would be reporting a
pass on the one capability the feature is named after. When voice tests land, they need a headed
project in `playwright.config.ts`, and the absence of headed coverage must be visible rather than
silent.

**Standing rule.** The startup probe must survive the call crashing, not merely returning false. A
refusal path that takes the tab down with it is not a refusal path.

### 2026-09-12 — a `file://` origin makes YouTube look broken

**What happened.** The captions spike loaded over `file://` and got player error **153** with no
caption data, which reads exactly like "this video has no captions". Error 153 is a missing HTTP
Referer: the IFrame API requires a real origin.

**Standing rule.** Before concluding a video lacks a capability, confirm the player was served over
http(s). Diagnosing 153 as a content problem would have sent the captions work down the wrong path
entirely — the spike nearly concluded the API could not do something it does.

### 2026-09-12 — a mock client hid an API contract the real one enforces

**What happened.** The agent loop forwarded the application's own tool names —
`playback.pause` — straight to the Messages API. Anthropic requires custom tool
names to match `^[a-zA-Z0-9_-]{1,128}$`, so every real request would have failed
validation before a single tool ran. Six loop tests passed, because a mock client
accepts any name.

**Why it matters beyond this bug.** The suite could not have caught it at any
level of diligence: the constraint lives in the provider, not in our code, and
the mock is what made the tests runnable in the first place. Only a reader who
knew the external contract could see it. This is the concrete local case for
Gate C existing at all.

**Standing rule.** Where a mock stands in for an external service, its
acceptance is not evidence about the real one. Name the external constraints the
mock does not enforce, and cover them somewhere the real shape is checked.

### 2026-09-12 — one valid request killed the backend

**What happened.** `server/index.ts` dispatched from a detached `void (async …)()`
with no rejection handler. The first catalog request whose fetcher threw became
an unhandled rejection and terminated the process with no response. Reproduced
before fixing: `health` went from 200 to dead after a single request.

**Standing rule.** Every detached async boundary needs a terminal handler that
turns a rejection into a typed reply. A crashed server is the loudest possible
unexpected state and still tells the caller nothing.

### 2026-09-12 — "speed 1.5" became 15x, and the suite was green

**What happened.** The matcher normalised an utterance by stripping `[.!?,]`
before parsing it. That is correct for sentence punctuation and catastrophic for
decimals: "speed 1.5" became "speed 15", which the nearest-available-rate lookup
then resolved to 2x. Driving the app at Gate B showed *"Understood as: Set
playback speed to 15x"* on screen.

**Why the tests passed.** The matcher test drove `'speed 1.5'` and asserted only
which TOOL matched — never the value it carried. The assertion could not fail on
a wrong number, so it never did. This is the same shape as the constitution's
warning about an assertion that cannot fail.

**Standing rule.** For any command that carries a value, assert the VALUE, not
just the routing. A test that checks which handler was chosen has not tested
what it was chosen to do.

### 2026-09-12 — a Gate B fixture hid the integration it stood in for

**What happened.** The US2 live run stubbed `/api/catalog/search` with a
Playwright route fixture so the UI path could be exercised without a YouTube
key. It passed, and looked like a thorough live run: search, narrow, queue, zero
network calls during narrowing, criteria and quota all displayed.

It could not have found what was actually broken. Vite had no `/api` proxy, so
the real Search button was fetching from the dev server and receiving **the
SPA's own HTML** — a 200 response that is not a catalog result. Gate C found it
by reading the config. Re-running the same flow with the stub removed showed it
in one line.

**Standing rule.** A fixture that stands in for the integration under test
cannot test it. When a live run stubs a boundary, say so in the report, and run
the same flow at least once with the stub removed — even if the far side is
expected to fail, because *how* it fails is the evidence. Here the unstubbed run
returned a JSON 500 with a stated reason, which is exactly right for a
deployment with no key, and is a different fact from HTML.

### 2026-09-12 — I committed with a red gate, twice

**What happened.** Phase 4's Gate C round 2 opened with codex reporting that
`npm run lint` was failing — on a file I had added AFTER running Gate A. The
same shape occurred at the end of Phase 2: the gate sequence was run, then more
was committed, and the gate never re-ran on what actually went in.

**Standing rule.** Gate A runs on the FINAL tree being committed, immediately
before `git commit`, not earlier in the phase. Anything added after the gate —
including a throwaway script — is part of the commit and is covered by the gate
or the gate covered nothing. Running four commands in a loop and reading four
PASSes says nothing about a file that did not exist yet.

## Decisions that go to codex

### 2026-09-12 — does the activity record cover calls refused before the handler ran?

**The two readings.** FR-029/SC-006 require every action the assistant takes to appear in the record.
`agent-mcp-react` validates arguments before a handler runs, so a schema-invalid call never reaches
application code. Reading A: it never became an action, so no entry. Reading B: an attempted call is
an action, and omitting it drops exactly the negative evidence IMMUNE-E demands.

**Codex said B**, with the caveat that if no boundary can be intercepted, the requirement must be
narrowed explicitly rather than the test silently narrowed.

**Decided: B, and the caveat does not bind** — the library exposes the boundary. It distinguishes the
two routes deliberately: `MCP_TOOL_ARGUMENTS_INVALID` (runtime) is the **agent's** schema refusal,
while `MCP_REACT_ARGUMENTS_INVALID` is a page script calling through the shared document registry,
which is not the assistant. The provider's `onToolCall` / `McpToolResultEvent` / `McpToolErrorEvent`
observers see the agent route including its refusals.

**Consequence for T015.** The record writer is driven by the provider's observer callbacks, **not**
by wrapping each handler. A handler wrapper cannot see a pre-handler refusal, and running both would
produce the duplicate entries codex warned about. One writer, one subscription, one entry per call.

### 2026-09-12 — what does `setCaptions({enabled:false})` report when the effect cannot be read back?

**The problem.** The T007 spike measured that enabling a caption track reads back
correctly and disabling does not — neither `setOption(track,{})` nor
`unloadModule` changes what `getOption` reports, and the rendered captions are
inside a cross-origin iframe so nothing can settle it. Captions may well turn
off; we cannot know.

**Codex recommended a third outcome** — `status: "unverified"` alongside ok and
refused — on the grounds that a refusal conflates *could not verify* with *did
not act*, while `ok:true` invites callers to read it as confirmed.

**Decided: codex's own stated fallback, not its first choice.** Constitution III
is NON-NEGOTIABLE and says there is no third outcome; the result type makes one
unrepresentable on purpose. Codex named the fallback for exactly this case: use
`ok:false` for *failure to establish completion*, with the effect recorded as
unknown — never a claim that captions stayed on.

So `enabled:false` returns `ok:false, reason: effect_unverifiable`, and the
detail says what was and was not established: **"Sent the request to turn
captions off; could not confirm whether captions are now off."** The activity
record carries the same sentence. A person reading it learns the truth, which a
bare success would have denied them.

**Standing rule.** A refusal reason is allowed to mean "I did something and
cannot confirm it", provided the detail says so. What is forbidden is a detail
that implies the opposite of what happened.

### 2026-09-12 — who decides whether an utterance narrows or re-searches?

**The problem.** 100 `search.list` calls per day for the whole deployment.
Narrowing is free; a fresh search costs 1 of 100. A conversational interface
invites reformulation, so the wrong rule empties the day in one sitting.

**I offered two readings** — the model decides by choosing a tool, or the
application decides by trying local narrowing first. **Codex rejected both** and
gave a third that is better than either: *the model interprets intent, the
application controls execution and spending.* Choosing a tool must not, by
itself, authorise spending.

**The insight I had missed:** a 100/day counter prevents *exceeding* the quota,
not *exhausting* it. Both are failures; only the second is likely. The fix is a
replenishing budget rather than a daily counter — burst capacity 2, one
allowance back every 16 minutes, a working cap of 90 with 10 held in reserve. A
sitting cannot drain the day no matter how the model behaves.

**Adopted.** `catalog.search` checks the budget before calling YouTube.
`catalog.narrow` never falls back to searching — the two mean different things,
and substituting one for the other would answer a question nobody asked. Every
result-returning call states the operation actually performed and the complete
effective criteria, so "Started a fresh search" is emitted by the code that
spent the quota rather than by a model describing what it thinks it did.

Distinct outcomes, none masquerading as success: `unchanged` when criteria
repeat, `ambiguous_reference` when intent is unclear, `quota_exhausted` when the
budget denies. Note that a newly applied filter legitimately leaving the same
videos visible is NOT `unchanged` — the criteria changed even though the set did
not.

Add further entries as under-determined decisions arise — two defensible readings of the spec, not
merely hard problems.
