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
  /**
   * Whether that tab has an open socket that is not published yet — initializing
   * or having its tools listed. The page's own status already says connected by
   * then, so a turn arriving now should wait for it, not be refused (T139).
   */
  isConnecting(sessionId: string, tabId: string): boolean;
  /** Resolves once that tab's connection has completed `initialize`. */
  waitFor(sessionId: string, tabId: string, timeoutMs: number): Promise<PageConnection>;
  /** How many waits are outstanding — observable so abandoned waits can be shown not to accumulate. */
  pendingWaits(): number;
  onFrameError(listener: (cause: Error) => void): void;
  onClosed(listener: (sessionId: string, tabId: string) => void): void;
  close(): Promise<void>;
}

/** One connection per tab of a session: two tabs never displace each other (Phase 11 Gate B). */
const keyOf = (sessionId: string, tabId: string): string => JSON.stringify([sessionId, tabId]);

const STATUS_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found' } as const;

function refuse(socket: Duplex, status: keyof typeof STATUS_TEXT, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${reason}`);
  socket.destroy();
}

export function attachGateway(http: HttpServer, options: { readonly initializeTimeoutMs?: number } = {}): Gateway {
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<string, PageConnection>();
  const sockets = new Map<string, WebSocket>();
  const waiters = new Map<string, ((c: PageConnection) => void)[]>();
  const frameErrorListeners: ((cause: Error) => void)[] = [];
  const closedListeners: ((sessionId: string, tabId: string) => void)[] = [];

  // Reported by default: an admitted page sending garbage is a protocol failure an
  // operator must be able to see, not an event nobody happens to listen for (Gate C).
  frameErrorListeners.push((cause) => process.stderr.write(`[gateway] ${cause.message}\n`));

  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://gateway');
    } catch {
      // Outside the request handler's error boundary: an unparseable target from
      // an unauthenticated caller must not be able to throw here and end the
      // process (Gate C, P1).
      refuse(socket, 400, 'The request target is not a valid URL.');
      return;
    }
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
      // The same tab reconnecting replaces its own earlier connection — withdrawn
      // NOW, not left published until the new one initializes, or a caller gets
      // a closed connection and its stale tool list (Gate C).
      const previous = sockets.get(key);
      sockets.set(key, ws);
      if (previous !== undefined) {
        // The published connection is gone from this moment, so say so here —
        // the old socket's close handler no longer owns this key, and if the
        // replacement never initializes, nothing else would (Gate C round 2).
        if (connections.delete(key)) for (const l of closedListeners) l(sessionId, tabId);
        previous.close();
      }

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
          // Published only once its tools are LISTED, not merely initialized: a
          // connection a turn cannot yet see tools on is not ready (contract, T134).
          void connection.listTools().then(
            (tools) => {
              if (sockets.get(key) !== ws) return;
              connections.set(key, connection);
              process.stdout.write(`[gateway] page connected (${label}): ${String(tools.length)} tools\n`);
              for (const resolve of waiters.get(key) ?? []) resolve(connection);
              waiters.delete(key);
            },
            (cause: unknown) => {
              process.stderr.write(`[gateway] page connected but listing its tools failed, closing it: ${String(cause)}\n`);
              ws.close();
            },
          );
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
    isConnecting: (sessionId, tabId) => sockets.has(keyOf(sessionId, tabId)) && !connections.has(keyOf(sessionId, tabId)),
    waitFor(sessionId, tabId, timeoutMs) {
      const key = keyOf(sessionId, tabId);
      const existing = connections.get(key);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = (c: PageConnection): void => {
          clearTimeout(timer);
          resolve(c);
        };
        const timer = setTimeout(() => {
          // Removed on timeout: a wait for a tab that never connects must not stay behind (Gate C).
          const list = (waiters.get(key) ?? []).filter((w) => w !== waiter);
          if (list.length === 0) waiters.delete(key);
          else waiters.set(key, list);
          reject(new Error(`No page connected for that tab within ${String(timeoutMs)}ms.`));
        }, timeoutMs);
        waiters.set(key, [...(waiters.get(key) ?? []), waiter]);
      });
    },
    pendingWaits: () => [...waiters.values()].reduce((n, list) => n + list.length, 0),
    onFrameError: (listener) => { frameErrorListeners.push(listener); },
    onClosed: (listener) => { closedListeners.push(listener); },
    async close() {
      for (const ws of sockets.values()) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
