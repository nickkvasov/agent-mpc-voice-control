import { Client, deserializeMessage, type Transport } from '@modelcontextprotocol/client';
import type { WebSocket } from 'ws';

/**
 * The MCP client's transport over one admitted page socket (T122, research R6).
 *
 * The page is the SERVER and dialed out; this process is the client answering
 * on a socket it did not open. Two rules of the SDK's Transport contract no type
 * checker enforces, both kept here (from the library's reference gateway):
 *
 * - only `client.connect()` calls `start()`, or frames arriving before the
 *   handlers are installed are dropped with no error anywhere;
 * - `close()` ends with `onclose`, exactly once, however the channel ended.
 *
 * One JSON-RPC message per text frame. A frame that is not JSON-RPC is reported
 * and dropped — never cast onto a type it has not been proven to inhabit, and
 * never allowed to desynchronise the stream.
 */
export const CLIENT_INFO = { name: 'voice-video-control-agent', version: '0.1.0' } as const;
export const INITIALIZE_TIMEOUT_MS = 10_000;

export function socketTransport(socket: WebSocket, onFrameError: (cause: Error) => void): Transport {
  let closed = false;
  const transport: Transport = {
    async start() {
      socket.on('message', (data) => {
        const frame = data.toString();
        let message: ReturnType<typeof deserializeMessage>;
        try {
          message = deserializeMessage(frame);
        } catch (cause) {
          const error = new Error(`the page sent a frame that is not JSON-RPC: ${frame.slice(0, 200)}`, { cause });
          onFrameError(error);
          transport.onerror?.(error);
          return;
        }
        transport.onmessage?.(message);
      });
      socket.on('error', (error) => transport.onerror?.(error));
      socket.on('close', () => {
        if (closed) return;
        closed = true;
        transport.onclose?.();
      });
    },
    async send(message) {
      socket.send(JSON.stringify(message));
    },
    async close() {
      socket.close();
      if (closed) return;
      closed = true;
      transport.onclose?.();
    },
  };
  return transport;
}

/**
 * Connects and completes `initialize`. Resolves when the PAGE has answered —
 * an open socket is a channel, and a channel with nothing answering looks
 * connected while the page appears to have no tools.
 */
export async function connectPage(
  socket: WebSocket,
  onFrameError: (cause: Error) => void,
  timeoutMs: number = INITIALIZE_TIMEOUT_MS,
): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  await client.connect(socketTransport(socket, onFrameError), { timeout: timeoutMs });
  return client;
}
