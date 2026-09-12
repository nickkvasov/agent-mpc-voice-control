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

Add further entries as under-determined decisions arise — two defensible readings of the spec, not
merely hard problems.
