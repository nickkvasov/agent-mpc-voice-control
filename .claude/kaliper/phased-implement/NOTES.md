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

## Decisions that go to codex

Nothing recorded yet. Add entries as under-determined decisions arise — two defensible readings of
the spec, not merely hard problems.
