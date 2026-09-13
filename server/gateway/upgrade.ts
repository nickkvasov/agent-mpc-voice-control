import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { redeemTicket } from '../ticket/route.ts';
import { connectPage, INITIALIZE_TIMEOUT_MS } from './transport.ts';
import { pageConnection, type PageConnection } from './page-connection.ts';

/**
 * Where a page's MCP server dials in (T121, research R6, contracts/backend-http.md).
 *
 * The ticket is redeemed DURING the upgrade. Unknown, expired or replayed →
 * HTTP 401 and no handshake, so the page never sees `open`. Accepting first and
 * closing after would let anything sent in that window reach an unauthenticated
 * peer. `noServer` is what makes refusing before the handshake possible.
 *
 * One connection per tab of a session; the same tab reconnecting replaces its
 * earlier connection, which is closed. Keyed by session alone, two tabs of one
 * browser replaced each other and reconnected in a loop (Phase 11 Gate B).
 */
export const MCP_PATH = '/mcp';

export interface Gateway {
  connectionFor(sessionId: string, tabId: string): PageConnection | undefined;
  /** Resolves once that tab's connection has completed `initialize`. */
  waitFor(sessionId: string, tabId: string, timeoutMs: number): Promise<PageConnection>;
  onFrameError(listener: (cause: Error) => void): void;
  onClosed(listener: (sessionId: string, tabId: string) => void): void;
  close(): Promise<void>;
}

/** One connection per tab of a session: two tabs never displace each other (Phase 11 Gate B). */
const keyOf = (sessionId: string, tabId: string): string => JSON.stringify([sessionId, tabId]);

function refuse(socket: Duplex, status: 401 | 404, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${status === 401 ? 'Unauthorized' : 'Not Found'}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${reason}`);
  socket.destroy();
}

export function attachGateway(http: HttpServer, options: { readonly initializeTimeoutMs?: number } = {}): Gateway {
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<string, PageConnection>();
  const sockets = new Map<string, WebSocket>();
  const waiters = new Map<string, ((c: PageConnection) => void)[]>();
  const frameErrorListeners: ((cause: Error) => void)[] = [];
  const closedListeners: ((sessionId: string, tabId: string) => void)[] = [];

  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://gateway');
    if (url.pathname !== MCP_PATH) {
      refuse(socket, 404, 'Not an MCP endpoint.');
      return;
    }
    const check = redeemTicket(url.searchParams.get('ticket') ?? '');
    if (!check.ok) {
      // The distinction (unknown / expired / replayed) belongs in the log, not in
      // a status a caller could probe to learn which tickets exist.
      process.stderr.write(`[gateway] refused upgrade: ticket ${check.reason}\n`);
      refuse(socket, 401, 'The connection ticket is not valid.');
      return;
    }
    const { sessionId, tabId } = check;
    const key = keyOf(sessionId, tabId);
    const label = `session ${sessionId.slice(0, 8)}…, tab ${tabId.slice(0, 8)}`;
    wss.handleUpgrade(request, socket, head, (ws) => {
      // The same tab reconnecting replaces its own earlier connection.
      const previous = sockets.get(key);
      sockets.set(key, ws);
      if (previous !== undefined) previous.close();

      ws.on('close', () => {
        if (sockets.get(key) !== ws) return;
        process.stdout.write(`[gateway] page disconnected (${label})\n`);
        sockets.delete(key);
        if (connections.delete(key)) for (const l of closedListeners) l(sessionId, tabId);
      });

      connectPage(ws, (cause) => frameErrorListeners.forEach((l) => l(cause)), options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS)
        .then((client) => {
          if (sockets.get(key) !== ws) {
            void client.close();
            return;
          }
          const connection = pageConnection(sessionId, tabId, client);
          connections.set(key, connection);
          // Operator evidence (IMMUNE-E): which session connected, and what the page offers.
          void connection.listTools().then(
            (tools) => process.stdout.write(`[gateway] page connected (${label}): ${String(tools.length)} tools\n`),
            (cause: unknown) => process.stderr.write(`[gateway] page connected but listing its tools failed: ${String(cause)}\n`),
          );
          for (const resolve of waiters.get(key) ?? []) resolve(connection);
          waiters.delete(key);
        })
        .catch((cause: unknown) => {
          // A socket that never completes initialize is not a connection.
          process.stderr.write(`[gateway] page did not initialize: ${String(cause)}\n`);
          ws.close();
        });
    });
  });

  return {
    connectionFor: (sessionId, tabId) => connections.get(keyOf(sessionId, tabId)),
    waitFor(sessionId, tabId, timeoutMs) {
      const key = keyOf(sessionId, tabId);
      const existing = connections.get(key);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No page connected for that tab within ${String(timeoutMs)}ms.`)), timeoutMs);
        const list = waiters.get(key) ?? [];
        list.push((c) => {
          clearTimeout(timer);
          resolve(c);
        });
        waiters.set(key, list);
      });
    },
    onFrameError: (listener) => { frameErrorListeners.push(listener); },
    onClosed: (listener) => { closedListeners.push(listener); },
    async close() {
      for (const ws of sockets.values()) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
