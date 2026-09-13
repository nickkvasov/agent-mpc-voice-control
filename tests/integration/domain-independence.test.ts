import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/app/commands.ts';
import { DomainScheduler } from '../../src/app/issue-fence.ts';
import { DOMAIN } from '../../src/vocab/command-domains.ts';
import { ok } from '../../src/mcp/result.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

const never = new Promise<void>(() => {});

describe('domains never wait for each other (FR-038)', () => {
  it('a stalled search does not delay pause', async () => {
    const commands = new CommandRegistry();
    const scheduler = new DomainScheduler(commands);
    void scheduler.run(commands.issue('manual'), [DOMAIN.catalogCuration], async () => {
      await never;
      return ok('search');
    });
    const pause = await scheduler.run(commands.issue('manual'), [DOMAIN.playback], async () => ok('paused'));
    expect(pause).toEqual(ok('paused'));
  });

  it('a stalled playback command does not delay a queue change', async () => {
    const commands = new CommandRegistry();
    const scheduler = new DomainScheduler(commands);
    void scheduler.run(commands.issue('agent'), [DOMAIN.playback], async () => {
      await never;
      return ok('seek');
    });
    expect(await scheduler.run(commands.issue('manual'), [DOMAIN.queue], async () => ok('queued'))).toEqual(ok('queued'));
  });
});

describe('cancellation (FR-004, research R7)', () => {
  it('a command revoked before it takes its domain is refused and never runs', async () => {
    const commands = new CommandRegistry();
    const scheduler = new DomainScheduler(commands);
    const c = commands.issue('agent');
    commands.revoke(c.commandId);
    let ran = false;
    const r = await scheduler.run(c, [DOMAIN.playback], async () => {
      ran = true;
      return ok('x');
    });
    expect(ran).toBe(false);
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.commandCancelled);
  });

  it('a command revoked while waiting for its domain is refused when its turn comes', async () => {
    const commands = new CommandRegistry();
    const scheduler = new DomainScheduler(commands);
    let release: (() => void) | undefined;
    const holding = scheduler.run(commands.issue('manual'), [DOMAIN.playback], async () => {
      await new Promise<void>((r) => { release = r; });
      return ok('holder');
    });
    const c = commands.issue('agent');
    const waiting = scheduler.run(c, [DOMAIN.playback], async () => ok('should not run'));
    // The holder really holds the lane before the revocation happens.
    while (release === undefined) await new Promise((r) => setTimeout(r, 0));
    commands.revoke(c.commandId);
    release();
    await holding;
    const r = await waiting;
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.commandCancelled);
  });

  it('late calls after revocation, completion and for unknown ids are refused and never re-attributed', () => {
    const commands = new CommandRegistry();
    const revoked = commands.issue('agent');
    const finished = commands.issue('agent');
    commands.revoke(revoked.commandId);
    commands.finish(finished.commandId);
    expect(commands.resolveForCall(revoked.commandId)).toMatchObject({ ok: false, reason: REFUSAL_REASON.commandCancelled });
    expect(commands.resolveForCall(finished.commandId)).toMatchObject({ ok: false, reason: REFUSAL_REASON.commandFinished });
    expect(commands.resolveForCall('cmd-never-issued')).toMatchObject({ ok: false, reason: REFUSAL_REASON.unknownCommand });
    // A later, open command is never substituted for a closed one.
    const open = commands.issue('agent');
    expect(commands.resolveForCall(finished.commandId)).not.toMatchObject({ ok: true, value: open });
  });

  it('revocation is recorded before anything remote is asked to cancel', () => {
    const commands = new CommandRegistry();
    const c = commands.issue('agent');
    const order: string[] = [];
    commands.revoke(c.commandId, () => {
      order.push(commands.get(c.commandId)?.state ?? 'missing');
    });
    expect(order).toEqual(['revoked']);
  });

  it('issueSeq is monotonic across every route and fixed at issuance', () => {
    const commands = new CommandRegistry();
    const seqs = (['voice', 'manual', 'agent', 'local_matcher'] as const).map((r) => commands.issue(r).issueSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
