import type { Client } from '@modelcontextprotocol/client';
import type { ToolCallOutcome, ToolDescriptor, ToolTransport } from '../agent/loop.ts';

/**
 * One page's MCP server, as the agent loop sees it (T123, research R6).
 *
 * The listing is cached and invalidated by the page's own
 * `notifications/tools/list_changed` — the page announces every change, since a
 * view mounting or unmounting changes its tools (FR-035). Re-listing on every
 * loop iteration was a workaround for ignoring that signal, costing a socket
 * round trip per iteration against SC-012's budget.
 */
export interface PageConnection extends ToolTransport {
  readonly sessionId: string;
  readonly tabId: string;
  /** How many times the page has actually been asked — observable for tests. */
  listRequests(): number;
  close(): Promise<void>;
}

const LIST_CHANGED = 'notifications/tools/list_changed';
/** Long enough for a person to read and answer a confirmation dialog. */
export const TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

export function pageConnection(sessionId: string, tabId: string, client: Client): PageConnection {
  let cached: Promise<readonly ToolDescriptor[]> | null = null;
  let requests = 0;

  client.setNotificationHandler(LIST_CHANGED, () => {
    cached = null;
    process.stdout.write(`[gateway] page announced a tool change (session ${sessionId.slice(0, 8)}…, tab ${tabId.slice(0, 8)})\n`);
  });

  return {
    sessionId,
    tabId,
    listRequests: () => requests,
    listTools() {
      if (cached === null) {
        requests += 1;
        const fetching = client.listTools().then((r) =>
          r.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })),
        );
        // A failed listing is not cached: the next call asks again.
        cached = fetching.catch((cause: unknown) => {
          cached = null;
          throw cause;
        });
      }
      return cached;
    },
    async callTool(name, input, signal): Promise<ToolCallOutcome> {
      let result: Awaited<ReturnType<Client['callTool']>>;
      try {
        result = await client.callTool(
          { name, arguments: input as Record<string, unknown> },
          // Explicit, not the SDK default: a tool may be waiting for a person to
          // answer a confirmation, which can outlast a request-sized timeout.
          { timeout: TOOL_CALL_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
        );
      } catch (cause) {
        // A protocol failure — no such tool, a closed channel — is information
        // the model can act on, not a thrown error that ends the turn.
        return { ok: false, reason: 'tool_unavailable', detail: cause instanceof Error ? cause.message : String(cause) };
      }
      const text = (result.content as readonly { type: string; text?: string }[] | undefined)
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('') ?? '';
      if (result.isError === true) {
        return { ok: false, reason: 'tool_error', detail: text === '' ? `${name} failed and said nothing more.` : text };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: true, value: text };
      }
      // The page's own outcome shape (Constitution III): ok with a value, or a reason.
      if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) {
        const o = parsed as { ok: unknown; value?: unknown; reason?: unknown; detail?: unknown };
        if (o.ok === true) return { ok: true, value: o.value };
        if (o.ok === false) {
          return { ok: false, reason: typeof o.reason === 'string' ? o.reason : 'refused', detail: typeof o.detail === 'string' ? o.detail : text };
        }
      }
      return { ok: true, value: parsed };
    },
    close: () => client.close(),
  };
}
