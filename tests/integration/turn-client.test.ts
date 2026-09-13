import { describe, expect, it } from 'vitest';
import { startTurn, LATE_AFTER_MS, type TurnView } from '../../src/assistant/turn-client.ts';

/** T128 — the page's side of a turn (R9, SC-001/SC-012 acknowledgement, FR-004). */
function streamingFetch() {
  const log: string[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let requestSignal: AbortSignal | undefined;
  const enc = new TextEncoder();
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    log.push('fetch');
    requestSignal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    requestSignal?.addEventListener('abort', () => { log.push('aborted'); try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return {
    fetchImpl,
    log,
    emit: (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    end: () => controller.close(),
  };
}

function manualTimers() {
  let now = 1_000;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return () => { timers.splice(timers.indexOf(t), 1); };
    },
    advance: (ms: number) => {
      now += ms;
      for (const t of [...timers]) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    },
  };
}

const request = { commandId: 'cmd-1', tabId: 'tab-1', text: 'go back a bit' };

describe('turn client', () => {
  it('renders the acknowledgement before any network call is made', async () => {
    const f = streamingFetch();
    const seen: string[] = [];
    startTurn(request, (v) => { seen.push(`${v.state}@${f.log.length === 0 ? 'before-fetch' : 'after-fetch'}`); }, { fetch: f.fetchImpl, revoke: () => {} });
    expect(seen[0]).toBe('acknowledged@before-fetch');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.log).toEqual(['fetch']);
  });

  it('follows the stream to done, collecting tool calls and messages', async () => {
    const f = streamingFetch();
    let last: TurnView | undefined;
    const turn = startTurn(request, (v) => { last = v; }, { fetch: f.fetchImpl, revoke: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    f.emit('acknowledged', { turnId: 't1', allowance: { sessionTurnsRemaining: 39 } });
    f.emit('tool_call', { toolName: 'playback.seek', input: {} });
    f.emit('tool_result', { toolName: 'playback.seek', ok: true });
    f.emit('message', { text: 'Went back ten seconds.' });
    f.emit('done', { stopReason: 'end_turn' });
    f.end();
    const final = await turn.done;
    expect(final.state).toBe('done');
    expect(final.toolCalls).toEqual([{ toolName: 'playback.seek', ok: true }]);
    expect(final.messages).toEqual(['Went back ten seconds.']);
    expect(last?.state).toBe('done');
  });

  it('marks a turn with no result after ten seconds as late, and it stays cancellable', async () => {
    const f = streamingFetch();
    const t = manualTimers();
    const states: string[] = [];
    const turn = startTurn(request, (v) => states.push(v.state), { fetch: f.fetchImpl, revoke: () => {}, now: t.now, setTimer: t.setTimer });
    await new Promise((r) => setTimeout(r, 0));
    f.emit('acknowledged', { turnId: 't1' });
    await new Promise((r) => setTimeout(r, 0));
    t.advance(LATE_AFTER_MS - 1);
    expect(states.at(-1)).not.toBe('late');
    t.advance(1);
    expect(states.at(-1)).toBe('late');
    turn.cancel();
    expect((await turn.done).state).toBe('cancelled');
  });

  it('cancelling revokes the command BEFORE aborting the request', async () => {
    const f = streamingFetch();
    const order: string[] = [];
    const turn = startTurn(request, () => {}, { fetch: f.fetchImpl, revoke: () => order.push(`revoked(aborted=${String(f.log.includes('aborted'))})`) });
    await new Promise((r) => setTimeout(r, 0));
    turn.cancel();
    order.push(`after-cancel(aborted=${String(f.log.includes('aborted'))})`);
    expect(order).toEqual(['revoked(aborted=false)', 'after-cancel(aborted=true)']);
    expect((await turn.done).state).toBe('cancelled');
  });

  it.each([
    [409, { reason: 'assistant_unavailable', detail: 'This tab is not connected to the assistant.' }],
    [429, { reason: 'assistant_allowance_spent', limit: 'day', resetsAt: 123, detail: 'Used up.' }],
    [503, { reason: 'agent_unavailable', detail: 'No credential.' }],
  ])('a %i before the stream becomes a refused turn with its reason', async (status, body) => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, ...body }), { status })) as typeof fetch;
    const final = await startTurn(request, () => {}, { fetch: fetchImpl, revoke: () => {} }).done;
    expect(final.state).toBe('refused');
    expect(final.refusal).toMatchObject(body);
  });

  it('a stream that ends without done is refused, never shown as finished', async () => {
    const f = streamingFetch();
    const turn = startTurn(request, () => {}, { fetch: f.fetchImpl, revoke: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    f.emit('acknowledged', { turnId: 't1' });
    f.end();
    const final = await turn.done;
    expect(final.state).toBe('refused');
    expect(final.refusal?.detail).toMatch(/ended before/);
  });
});
