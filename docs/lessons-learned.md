# Lessons learned adopting `agent-mcp-react`

Problems this application actually hit while integrating [`agent-mcp-react`](https://github.com/A-Launch/agent-mcp-react) and an agent runtime, and what it does about each. Each was found while building, running or reviewing this app, and several passed a green test suite first. Read the library's own [Things that will bite you](https://github.com/A-Launch/agent-mcp-react#things-that-will-bite-you) as well; the two lists overlap only where noted.

[Back to the README](../README.md)

## In the page

### Tools were declared, but the page published none

- **Symptom.** Components called their tool declarations, buttons worked, and an agent saw an empty page.
- **Cause.** `AgentMcpProvider` was written but never mounted, so no declaration had a provider to register with.
- **Fix.** Mount the provider at the root, above everything that declares a tool ([`src/main.tsx`](../src/main.tsx)). The gateway logs how many tools a page published when it connects — `34 tools` here — so a zero is visible at once.

### A handler wrapper cannot record every call

- **Symptom.** Calls refused before any handler ran — arguments that failed the schema — were missing from the activity record.
- **Cause.** A wrapper around handlers only sees calls that reach a handler. Recording from both a wrapper and the observers writes two entries for one call.
- **Fix.** Handlers record what they did; the provider's `onToolResult` / `onToolError` observers record only calls refused before a handler ran, and only terminal phases ([`src/activity/from-observed-call.ts`](../src/activity/from-observed-call.ts)).

### Observed refusals had no arguments

- **Symptom.** Entries for pre-handler refusals stored `arguments: null`, so the record could not say what was asked.
- **Cause.** Observed call payloads are off unless requested.
- **Fix.** `observability={{ payloads: 'values' }}` on the provider ([`src/mcp/provider.tsx`](../src/mcp/provider.tsx)). The events stay in the page.

### A handler cannot tell which command it serves

- **Symptom.** With a person clicking and an assistant acting at the same time, there was no way to know whether an arriving call belonged to a command that was still current.
- **Cause.** Version 0.3.0 hands a tool handler no request metadata.
- **Fix.** Every tool's wire schema carries a reserved `commandId`. The backend strips it from what the model sees and writes the turn's own id into every call, so the model can neither choose nor forge it ([`src/mcp/command-id.ts`](../src/mcp/command-id.ts), [`server/assistant/attributed-transport.ts`](../server/assistant/attributed-transport.ts)). That is what lets a newer human action refuse a stale agent call.

### A confirmation prompt is not consent

- **Symptom.** None in this app — it was designed around the library's warning.
- **Cause.** A tool's `confirmation: 'required'` gates the library's own bridge; other callers of the page's tool registry skip it (the library documents this).
- **Fix.** Destructive actions ask the person inside the action itself, and anything but a clear yes refuses ([`src/app/tool-actions.ts`](../src/app/tool-actions.ts), [`src/mcp/confirmation-resolver.ts`](../src/mcp/confirmation-resolver.ts)).

## Between the page and the agent

### Two tabs kept replacing each other

- **Symptom.** With the app open in two tabs of one browser, the connections displaced each other and reconnected in a loop.
- **Cause.** The gateway keyed page connections by session alone.
- **Fix.** Key them by session **and** tab, using `useMcpTabId` on the page and in the ticket request ([`server/gateway/upgrade.ts`](../server/gateway/upgrade.ts)).

### "Connected" on the page, refused by the backend

- **Symptom.** A command sent right after the page said it was connected was refused as "not connected".
- **Cause.** The page reports connected when its MCP handshake completes; the backend publishes the connection only after it has listed the page's tools, one round trip later.
- **Fix.** A turn for a tab whose socket is open but still being listed waits briefly for it; a tab with no socket is refused at once ([`server/assistant/turns.ts`](../server/assistant/turns.ts)).

### Re-listing tools on every step was slow; not re-listing was wrong

- **Symptom.** Listing the page's tools before every model step added a socket round trip to each step; caching the list risked acting on a view that had closed.
- **Cause.** Tools change whenever a view mounts or unmounts.
- **Fix.** Cache the listing per page and drop it when the page sends `notifications/tools/list_changed` ([`server/gateway/page-connection.ts`](../server/gateway/page-connection.ts)).

### Tool names the model API rejects

- **Symptom.** Found in code review, not by a test: the API would reject every request carrying these tools before any tool ran. All loop tests passed, because a mock client accepts any name.
- **Cause.** Tools are named `playback.pause`; the Claude Messages API allows only `[a-zA-Z0-9_-]` in tool names.
- **Fix.** The agent runtime aliases names (`playback__pause`), maps them back, and refuses loudly if two names collapse to one alias ([`server/agent/tool-names.ts`](../server/agent/tool-names.ts)).

### A tool vanished in the middle of a turn

- **Symptom.** A panel closed while the assistant was mid-turn; a later step called a tool from an earlier step, and the page received an alias it never declared.
- **Cause.** Names were resolved through the current listing only.
- **Fix.** The runtime remembers every alias shown during the turn, and the page refuses a call to a closed view by naming the view to open ([`server/agent/loop.ts`](../server/agent/loop.ts), [`src/mcp/tool-availability.ts`](../src/mcp/tool-availability.ts)).
