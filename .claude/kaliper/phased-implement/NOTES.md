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

### 2026-09-13 — a fix that was written, tested, and never called

**What happened.** Phase 5's queue-restoration fix went through three Gate C
rounds. Rounds 1 and 2 wrote `restorePosition`, exported it, and tested it —
while `undoAction` went on computing the position from the stale index. The
application behaved exactly as before. The suite was green because the tests
reached the HELPER, and the helper reached nothing.

Worse: my break-it check passed too. Reverting the app's line did not turn
anything red, because the test imported the helper directly rather than
exercising the path.

**Root cause.** The logic lived inside a React callback, where a test cannot
reach it. So "extract a helper and test it" felt like coverage while leaving the
call site untested — and a call site is where behaviour lives.

**Standing rule.** When a fix goes into a component callback, EXTRACT the
behaviour into a module function and have the callback call it in one line. Then
test that function and break it. If breaking the implementation does not turn a
test red, the test is not covering the fix — re-check before believing a green
break-it, because a break-it that passes proves nothing at all.

### 2026-09-13 — an effect recorded against the wrong action

**What happened.** Effects were attached with a separate `attachEffect` call
that wrote to the LAST entry in the record. Callers invoked it inside the
handler — which runs BEFORE the writer has written its own entry — so the effect
landed on the PREVIOUS action. Driving it showed a search offering an Undo
button, and pressing it reported *"Undid: Search for talks"* while removing a
video from a collection.

**Why it is worth recording.** Nothing was wrong with either piece. The writer
was correct, the handler was correct, and the bug lived entirely in the ORDER
they ran in — invisible in any single file, and invisible to the unit tests,
because both halves behaved exactly as written.

**Standing rule.** A fact derived from a result belongs to the code that writes
the result, not to a second call the caller makes afterwards. `invokeRecorded`
now takes an `effectOf(value)` function and attaches it itself, so an effect
cannot be filed against an action that did not cause it.

**Second rule, from the same run:** if an entry is offered as undoable, its
inverse must actually be implemented. Recording a label effect with no
annotation-undo path produced an Undo button that refused when pressed, which
FR-044 forbids in as many words.

### 2026-09-13 — what the live runs caught that the suite did not (T090)

Collected at the end of the run. Every item below was green in the test suite at
the moment it was found.

| Found by | What the suite said | What was actually true |
|---|---|---|
| Gate B, Phase 3 | matcher tests green | `"speed 1.5"` applied 2x — the test asserted which TOOL matched, never the value |
| Gate B, Phase 4 | US2 flow green | the Search button was fetching the SPA's own HTML; the run had stubbed that route |
| Gate B, Phase 6 | unit tests green | effects were filed against the PREVIOUS action; a search offered Undo and "undid" a collection change |
| Gate B, Phase 6 | label test green | the label was recorded and never applied — record and screen disagreed |
| Gate C, Phase 3 | Gate A green | `test:e2e` was RED and sat in `final`, deferred four phases away |
| Gate C, Phase 5 | break-it "passed" | the fix was never called; the test reached the helper, and the helper reached nothing |
| T089 break-it pass | all green | a guard in `resolveCountedConfirmation` was dead code — removing it changed nothing |

**The pattern.** Not one of these was a wrong assertion. Each was an assertion
about the wrong thing: the routing rather than the value, the helper rather than
the call site, the stub rather than the integration, the record rather than the
screen. A suite can only fail where someone pointed it, and these are the places
nobody pointed it.

**What actually caught them.** Driving the application and reading the output.
In four of the seven the defect was visible in a single line of screen text.

### 2026-09-13 — the break-it script could report success having proved nothing

**What happened.** The T089 pass counted any non-zero exit from `npm test` as a
mutation proved. A runner that failed to start, or an unrelated pre-existing
failure, would have printed *"9 of 9 checks proved"* and exited zero. A missing
anchor — a guard that had moved or been reformatted — was skipped without being
counted at all, so with every anchor stale the script reported *"0 of 0 proved"*
and passed.

**Why it matters more than an ordinary bug.** This is the tool whose entire
purpose is to catch tests that cannot fail, and it had the same defect. It was
green while proving nothing, which is precisely the condition it exists to
detect.

**Fixed three ways.** A baseline run must be green before any mutation is
attempted. Each check now names the test it must break, and the mutation only
counts if THAT test is the one that failed — a suite going red somewhere else
proves nothing about this guard. And a stale anchor is counted as UNPROVED and
fails the pass, rather than quietly shrinking coverage as the source moves.

**Verified by sabotaging the script itself:** breaking one anchor produces
`STALE`, `8 of 9`, and exit 1.

**Standing rule.** A verification tool needs verifying. Ask what it prints when
it is given nothing to check — if that is indistinguishable from success, it is
not a check.

### 2026-09-13 — the first real credentials found a stand-in behind every green gate

**What happened.** Adding a YouTube key should have been enough to verify the one
"unverified" path. It was not: both backend fetchers threw unconditionally, so
there was no client to verify. Driving the real page with a real key then showed
every duration as 0 (a `?? 0` in the page's client), and clicking **Play** on a
real result answered "Would play … once the player embed lands" — the player the
whole of US1 was gated on is an in-memory stand-in, and T031 was marked done
with only its interface written.

**Why the gates missed it.** Every layer was tested against a double of the layer
below, and every double was well-behaved: fixtures always had durations, the
stand-in player always had a video. The phase closeout checked that projections
*agreed*; a stand-in agrees with everything. "Unverified — no key" was written
down as the gap, and that phrasing hid that there was nothing to put a key into.

**Standing rules.**
- A gap is described by what *exists*, never by what is missing to test it. "No
  key" and "no client" call for different work.
- A task whose text names handlers or an embed is not done when an interface is.
  Check the named behaviour, not the named file.
- A stand-in in `App.tsx` is a finding at every Gate B until it is gone. The live
  gate drives the product; driving a stand-in is `NOT RUN` for whatever it stands
  in for.

### 2026-09-13 — the dev server handed out both API keys

**What happened.** Credentials were added as `dev.env` in the project root. Git
did not ignore it, and Vite's dev server served it: `GET /dev.env`, `?raw` and
`/@fs/<root>/dev.env` all returned 200 with both keys. Vite's default deny list
covers `.env` and `.env.*`, not `*.env`. Codex raised it in review; requesting the
file confirmed it. The e2e sentinel test failed on all six probes before the deny
rule and passes after.

**Standing rules.**
- A new file holding a secret is checked against *every* server that serves the
  tree, not only against git. `.gitignore` protects the history, not the port.
- `server.fs.deny` replaces Vite's defaults; restate them when adding to it.
- zsh ties `path` to `PATH`: a `for path in …` loop wiped the command path and the
  first probe reported "no key lines" having run nothing. A probe that cannot
  fail is not evidence — look at the status code before the verdict.

### 2026-09-13 — ten codex rounds on one adapter, and what kept recurring

Ten review rounds on the YouTube client, every finding verified, every one real.
Seven were the same defect in new places: **a failure hardening into an
answer** — an unreadable 200, a wrong-shaped 200, a throttle, a `PT0S` live
video, a failed duration lookup, a backtracked chapter timestamp, each becoming
a cached determination. Three were **waits nobody bounded** — the refill on a hit,
the fill on a fresh search, and upstream itself — each holding "pause" through the
shared command chain.

Twice the test written for a race could not fail: once it passed with the bug
restored, once it failed only by hanging. Both surfaced because break-it was run
on the test, not assumed.

**Standing rules.**
- For any upstream call, enumerate before writing it: non-200, unreadable 200,
  wrong-shaped 200, throttle vs exhaustion, a zero that means "not yet", and no
  response at all. Each gets a test that says which of *failure* or *unknown* it
  becomes — never an empty or zero answer.
- Any `await` in a path the command chain waits on needs a bound, and a test that
  stalls it.
- A race test is not written until the bug has been reproduced outside it.

### 2026-09-13 — Phase 9: what publishing the tools exposed

**The page had never been an MCP server.** The provider was written and never mounted; no component
called `useMcpTool`; no tool had an input schema. 90 tasks and 251 tests were green. Registering the
tools for real exposed three defects no test could see while nothing was registered:

- **Two activity recorders** — `App.tsx` and `mcp/provider.tsx` each built one. Mounting the provider
  would have filed pre-handler refusals into a record nobody displays.
- **The observer recorded every `result` as success**, so a handler's `{ok:false}` would have been
  "succeeded", and assistant actions would have carried no effect to undo. Now the observer records only
  calls whose `invoke` gate is `notRun`; the handler path records the rest. The 2026-09-12 decision
  stands — the library exposes the boundary, and `gates` is how to read it.
- **The record view refreshed only after the page's own actions.** A refusal written by any other path
  stayed invisible. Fixed at the mechanism: the recorder notifies subscribers.

**Two tests that could not fail, both caught by break-it.** The first break-it run of the fence
reported six guards "still green": zsh does not word-split an unquoted `$T`, so vitest received one
path containing a space, matched no files, and "no failures printed" read as green. The harness now
requires a reported failure count. And a T095 assertion checked the activity entry *contained*
`playback.pause` — the raw tool id Gate B then showed was the defect.

**FR-035 had never been exercisable.** Every view was permanently mounted, so "the capability's view is
not open" could not happen. Hide/Show controls made it real; the registry count is observed to drop.

**Dead code reported done.** `command-cancel.ts` (T046, FR-004) was imported by nothing. Deleted.

**Standing rules.**
- A break-it harness reports the failure count it observed, never the absence of failure lines.
- Pass argument lists to commands as separate words; in zsh an unquoted variable is one word.
- An assertion on a label checks the words the person sees, and that the internal id is absent.
- "Implemented" means reachable from the running page. Grep for the caller before marking a task done.

### 2026-09-13 — Phase 9 Gate C: three rounds on one inferred join

Round 1 found six real defects in the new action layer (each reproduced by a test before its fix).
Rounds 2 and 3 were both regressions in round 1's fixes — and both in the same place: matching a
handler to its observed terminal. `agent-mcp-react` 0.3.0 never tells a handler which invocation it
serves, so the join is inferred from tool, arguments and the invocation's signal. Round 2: arguments
alone misattributed identical concurrent calls. Round 3: a completed call aborted late left its start
unretired. Each fix closed its ordering; one ordering cannot be closed from the page and is documented
in `src/activity/handler-starts.ts` as a known limit, with the real fix named: the library passing
request `_meta` to handlers.

**A rule no test can observe was removed, not kept.** A "prefer a running handler" preference stayed
green under break-it: identical starts are interchangeable, so which one is consumed changes no entry
count in any ordering.

**Harness again.** A stray `cat >` with no heredoc blocked a break-it run on stdin for 400 seconds; it
looked like a hanging test. Before trusting a stuck run, check what is actually running.

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

### 2026-09-12 — what does "a later action depends on it" mean for undo?

**The problem.** FR-044 disables undo when later actions depend on an entry, and
FR-030 promises undo of ANY reversible entry. Read too broadly, almost nothing
stays undoable — adding X to a collection then adding Y would block undoing X.
Read too loosely, an undo silently does the wrong thing.

**Codex chose the permissive reading with guarded inverses**, and gave the rule
three concrete conditions. A later action blocks undo when it:
1. overwrites or consumes the earlier effect,
2. destroys an identity the inverse needs, or
3. establishes a still-effective state the inverse would violate.

**Sharing a container is not enough.** Effects are tracked by stable identity —
membership `(collection, video)`, a collection's name, one queue occurrence — so
two independent additions to the same collection do not block each other.

**Adopted, with the settled cases:** add X then add Y → X still undoable; add X
then remove X → blocked (the inverse would be a no-op); rename C→D→E → blocked
(restoring C would overwrite E); add X then delete C → blocked (the identity is
gone); queue X then clear → blocked.

**Two requirements I had not planned for**, both adopted:
- **A fourth state.** Where eligibility cannot be established, the record says
  *undo availability unknown* with the reason and offers no button — Constitution
  IV applied to eligibility itself, not just to data.
- **Revalidate at execution, not only at render.** The guard is checked again
  when undo actually runs, and a no-op is never reported as a successful undo.

Add further entries as under-determined decisions arise — two defensible readings of the spec, not
merely hard problems.

### 2026-09-13 — how does the page know which assistant command a tool call belongs to?

**The decision.** FR-038 (clarified 2026-09-13) refuses an assistant action that a newer command in the
same domain has overtaken. That needs every arriving `tools/call` attributed to its command — and
`agent-mcp-react` 0.3.0 gives a handler only `(input, { signal, afterRender })`. Options put to codex:
one turn at a time (wait or refuse), an injected `commandId`, stamping with the oldest running turn's
sequence, or something better.

**Codex recommended** the injected `commandId`, with schemas derived mechanically so the model never sees
or sets the field, only the id on the wire, and the fence left in the page. It rejected the others by
scenario — and corrected my framing of one: I had called oldest-turn stamping "safe but may falsely
refuse". It is **unsafe**: a newer turn's action stamped with the older sequence lets a genuinely stale
action through the equality check.

**It also found two holes in the fence itself**: checking at handler entry lets an action that awaits a
search or confirmation overwrite a newer one when it resumes, so the check must be at application; and
`playback.next`/`previous` affect the queue, so a tool declares a set of domains, not one.

**Decided**: as recommended (research.md R7). One divergence: the reason is `overtaken_by_newer_command`,
not codex's `superseded_by_newer_command`, because `superseded` already names an undo state here.

