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
/** How long a turn waits for a tab whose socket is open but whose tools are still being listed. */
export const CONNECTING_WAIT_MS = 3000;
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

  // Listening from the start: a request can close while it waits below for its
  // tab, and a close missed then left the turn admitted, counted and running
  // for nobody (Phase 14 Gate C).
  const controller = new AbortController();
  // The page aborting the request is the person cancelling (FR-004).
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  const sessionId = sessionFromCookieHeader(req.headers.cookie);
  let page = sessionId === null ? undefined : deps.gateway.connectionFor(sessionId, tabId);
  // The page reports connected when its MCP handshake completes; the backend
  // publishes the connection only once it has LISTED the page's tools, a round
  // trip later. A command sent in that gap was refused while the page said the
  // assistant was available (T139). A tab still connecting is waited for, briefly;
  // a tab with no socket at all is refused at once.
  if (sessionId !== null && page === undefined && deps.gateway.isConnecting(sessionId, tabId)) {
    page = await deps.gateway.waitFor(sessionId, tabId, CONNECTING_WAIT_MS).catch(() => undefined);
    // Gone while it waited: nothing to admit, count or run.
    if (controller.signal.aborted) return;
  }
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

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event: string, data: Record<string, unknown>): void => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('acknowledged', { turnId, allowance: admission.snapshot });

  /**
   * Calls sent to the page, whatever they answered. A refusal is not proof of no
   * effect: `playback.next` can load a video and then refuse `autoplay_blocked`
   * (Gate C round 2), so only a turn that sent nothing may say nothing was done.
   */
  let attemptedCalls = 0;
  const forward = (e: TurnEvent): void => {
    if (e.type === 'tool_call') attemptedCalls += 1;
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
    const why = typeof status === 'number' ? `the assistant service rejected a request (${String(status)})` : 'the assistant could not continue';
    // Never "nothing was done" once a tool was called: the page may already have
    // changed, and saying otherwise invites a duplicate retry (Gate C).
    const already = attemptedCalls === 0
      ? 'Nothing was done.'
      : `${String(attemptedCalls)} action${attemptedCalls === 1 ? ' was' : 's were'} already attempted before it stopped — see above for what each did.`;
    send('refused', { reason: 'turn_failed', detail: `This request did not finish: ${why}. ${already} Everything here still works by hand.` });
    send('done', { stopReason: 'failed' });
  } finally {
    res.end();
  }
}
