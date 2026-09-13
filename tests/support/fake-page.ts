import { WebSocket } from 'ws';
import { deserializeMessage, Server, type Transport } from '@modelcontextprotocol/server';

/**
 * A stand-in for the browser page in Node tests: an MCP SERVER that dials OUT
 * to the gateway over a WebSocket, one JSON-RPC message per text frame — the
 * same direction and framing `agent-mcp-react` uses. Built from the SDK's own
 * Server so the gateway is tested against the real protocol, not against a
 * hand-written approximation of it.
 */
export interface FakeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Receives the call's own signal, which aborts when the caller cancels the MCP request. */
  readonly handler: (args: Record<string, unknown>, signal: AbortSignal | undefined) => unknown | Promise<unknown>;
}

export interface FakePage {
  readonly socket: WebSocket;
  readonly calls: { name: string; args: Record<string, unknown> }[];
  setTools(tools: readonly FakeTool[]): Promise<void>;
  close(): void;
}

/** Resolves with the HTTP status when the upgrade is refused, or the page once open. */
export function dialPage(
  url: string,
  tools: readonly FakeTool[],
  /** Holds each `tools/list` answer this long: a page whose listing is still on its way. */
  options: { readonly listDelayMs?: number } = {},
): Promise<{ refused: number } | { page: FakePage }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let current = [...tools];
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    socket.once('unexpected-response', (_req, res) => {
      resolve({ refused: res.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once('error', (error) => {
      if (socket.readyState !== WebSocket.CLOSED) reject(error);
    });
    socket.once('open', () => {
      const server = new Server({ name: 'fake-page', version: '0' }, { capabilities: { tools: { listChanged: true } } });
      server.setRequestHandler('tools/list', async () => {
        if ((options.listDelayMs ?? 0) > 0) await new Promise((r) => setTimeout(r, options.listDelayMs));
        return {
        tools: current.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { type: 'object' as const, ...inputSchema } })),
        };
      });
      server.setRequestHandler('tools/call', async (request, ctx) => {
        const { name, arguments: args = {} } = request.params as { name: string; arguments?: Record<string, unknown> };
        calls.push({ name, args });
        const tool = current.find((t) => t.name === name);
        if (tool === undefined) return { isError: true, content: [{ type: 'text', text: `no tool ${name}` }] };
        const signal = (ctx as { mcpReq?: { signal?: AbortSignal } } | undefined)?.mcpReq?.signal;
        return { content: [{ type: 'text', text: JSON.stringify(await tool.handler(args, signal)) }] };
      });
      const transport: Transport = {
        async start() {
          socket.on('message', (data) => {
            transport.onmessage?.(deserializeMessage(data.toString()));
          });
          socket.on('close', () => transport.onclose?.());
        },
        async send(message) {
          socket.send(JSON.stringify(message));
        },
        async close() {
          socket.close();
        },
      };
      void server.connect(transport).then(() =>
        resolve({
          page: {
            socket,
            calls,
            async setTools(next) {
              current = [...next];
              await server.sendToolListChanged();
            },
            close: () => socket.close(),
          },
        }),
      );
    });
  });
}
