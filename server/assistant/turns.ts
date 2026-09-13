import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, type TurnEvent } from '../agent/loop.ts';
import type { Gateway } from '../gateway/upgrade.ts';
import { sessionFromCookieHeader } from '../ticket/session.ts';
import type { AssistantAllowance } from './allowance.ts';
import { attributedTransport } from './attributed-transport.ts';

/**
 * POST /api/assistant/turns — one command through the assistant (R9, FR-046).
 *
 * Refusals that need no model — no page connection, no credential, allowance
 * spent — are plain HTTP statuses before any stream opens. An admitted turn is a
 * `text/event-stream`: `acknowledged`, then `tool_call` / `tool_result` /
 * `message` as they happen, then `done`, always last. The request closing
 * cancels the turn: the model stream, and any tool call already on the page.
 */
export const TURNS_PATH = '/api/assistant/turns';

export interface TurnDeps {
  readonly gateway: Gateway;
  readonly allowance: AssistantAllowance;
  /** Null when no credential is configured — a stated condition, never a fake model. */
  readonly model: () => Anthropic | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TEXT = 2000;

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, ...body }));
}

export async function handleTurn(req: IncomingMessage, res: ServerResponse, body: unknown, deps: TurnDeps): Promise<void> {
  const b = (body ?? {}) as { commandId?: unknown; tabId?: unknown; text?: unknown };
  if (typeof b.commandId !== 'string' || !ID.test(b.commandId) || typeof b.tabId !== 'string' || !ID.test(b.tabId)
    || typeof b.text !== 'string' || b.text.trim() === '' || b.text.length > MAX_TEXT) {
    json(res, 400, { reason: 'invalid_turn', detail: 'A turn needs a commandId, a tabId and the command text.' });
    return;
  }
  const { commandId, tabId, text } = b as { commandId: string; tabId: string; text: string };

  const sessionId = sessionFromCookieHeader(req.headers.cookie);
  const page = sessionId === null ? undefined : deps.gateway.connectionFor(sessionId, tabId);
  if (sessionId === null || page === undefined) {
    json(res, 409, { reason: 'assistant_unavailable', detail: 'This tab is not connected to the assistant.' });
    return;
  }
  const model = deps.model();
  if (model === null) {
    json(res, 503, { reason: 'agent_unavailable', detail: 'The agent host has no credential configured.' });
    return;
  }
  const admission = deps.allowance.admit(sessionId);
  if (!admission.ok) {
    json(res, 429, { reason: 'assistant_allowance_spent', limit: admission.limit, resetsAt: admission.resetsAt, detail: admission.detail });
    return;
  }

  const turnId = randomUUID();
  const controller = new AbortController();
  // The page aborting the request is the person cancelling (FR-004).
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event: string, data: Record<string, unknown>): void => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('acknowledged', { turnId, allowance: admission.snapshot });

  const forward = (e: TurnEvent): void => {
    if (e.type === 'tool_call') send('tool_call', { toolName: e.toolName, input: e.input });
    else if (e.type === 'tool_result') {
      send('tool_result', e.outcome.ok
        ? { toolName: e.toolName, ok: true }
        : { toolName: e.toolName, ok: false, reason: e.outcome.reason, detail: e.outcome.detail });
    } else send('message', { text: e.text });
  };

  try {
    const result = await runAgentTurn(model, attributedTransport(page, commandId), text, { signal: controller.signal, onEvent: forward });
    send('done', { stopReason: result.stopReason ?? 'end_turn' });
  } catch (cause) {
    // The full error is for the operator; the person gets what happened in words.
    // Gate B showed the raw API error JSON on screen.
    process.stderr.write(`[assistant] turn ${turnId} failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    const status = (cause as { status?: unknown } | null)?.status;
    send('refused', {
      reason: 'turn_failed',
      detail: typeof status === 'number'
        ? `The assistant service rejected the request (${String(status)}). Nothing was done; everything here still works by hand.`
        : 'The assistant could not finish this request. Nothing more was done; everything here still works by hand.',
    });
    send('done', { stopReason: 'failed' });
  } finally {
    res.end();
  }
}
