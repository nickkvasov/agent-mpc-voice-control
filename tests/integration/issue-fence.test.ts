import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/app/commands.ts';
import { DomainScheduler } from '../../src/app/issue-fence.ts';
import { DOMAIN } from '../../src/vocab/command-domains.ts';
import { ok, refuse, type ToolResult } from '../../src/mcp/result.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

/** A promise the test resolves by hand, so completion order is chosen, not hoped for. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const commands = new CommandRegistry();
  const scheduler = new DomainScheduler(commands);
  const applied: string[] = [];
  const act = (label: string, wait?: Promise<void>) => async (): Promise<ToolResult<string>> => {
    if (wait !== undefined) await wait;
    applied.push(label);
    return ok(label);
  };
  return { commands, scheduler, applied, act };
}

describe('issue fence — order within a domain (FR-038, research R7)', () => {
  it('local commands issued in order apply in order even when the first is slower', async () => {
    const { commands, scheduler, applied, act } = harness();
    const slow = gate();
    const a = commands.issue('manual');
    const b = commands.issue('manual');
    const ra = scheduler.run(a, [DOMAIN.catalogCuration], act('search', slow.opened));
    const rb = scheduler.run(b, [DOMAIN.catalogCuration], act('narrow'));
    await tick();
    expect(applied).toEqual([]); // the narrow waits for the search in its own domain
    slow.open();
    expect(await ra).toEqual(ok('search'));
    expect(await rb).toEqual(ok('narrow'));
    expect(applied).toEqual(['search', 'narrow']);
  });

  it('an older command placed after a newer one applied is refused, naming the newer command', async () => {
    const { commands, scheduler, applied, act } = harness();
    const older = commands.issue('agent'); // "go back a bit" — interpretation still running
    const newer = commands.issue('manual'); // pause, pressed meanwhile
    expect(await scheduler.run(newer, [DOMAIN.playback], act('pause'))).toEqual(ok('pause'));
    const late = await scheduler.run(older, [DOMAIN.playback], act('seek'));
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
    expect(late.detail).toContain(newer.commandId);
    expect(applied).toEqual(['pause']);
  });

  it.each([
    ['a click', 'manual'],
    ['a matcher command', 'local_matcher'],
    ['another assistant command', 'agent'],
  ] as const)('older assistant work is overtaken by %s', async (_label, route) => {
    const { commands, scheduler, applied, act } = harness();
    const older = commands.issue('agent');
    const newer = commands.issue(route);
    await scheduler.run(newer, [DOMAIN.queue], act('newer'));
    const r = await scheduler.run(older, [DOMAIN.queue], act('older'));
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
    expect(applied).toEqual(['newer']);
  });

  it('two concurrent assistant commands keep their own attribution in reversed completion order', async () => {
    const { commands, scheduler } = harness();
    const first = commands.issue('agent');
    const second = commands.issue('agent');
    const g1 = gate();
    const g2 = gate();
    const seen: string[] = [];
    // Identical business arguments; only the command differs.
    const call = (c: typeof first, g: typeof g1) =>
      scheduler.run(c, [DOMAIN.catalogCuration], async () => {
        await g.opened;
        seen.push(c.commandId);
        return ok(c.commandId);
      });
    const p1 = call(first, g1);
    const p2 = call(second, g2);
    g2.open();
    g1.open();
    expect(await p1).toEqual(ok(first.commandId));
    expect(await p2).toEqual(ok(second.commandId));
    // Exclusive within the domain: the first placed runs first, whatever finished its wait first.
    expect(seen).toEqual([first.commandId, second.commandId]);
  });

  it('a refusal does not raise the fence', async () => {
    const { commands, scheduler, applied, act } = harness();
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    const refused = await scheduler.run(newer, [DOMAIN.playback], async () =>
      refuse(REFUSAL_REASON.notPlaying, 'Nothing is playing.'),
    );
    expect(refused.ok).toBe(false);
    // Nothing applied for the newer command, so the older one is not overtaken.
    expect(await scheduler.run(older, [DOMAIN.playback], act('older'))).toEqual(ok('older'));
    expect(applied).toEqual(['older']);
  });

  it('a partial effect raises the fence even when the call ends in a refusal', async () => {
    const { commands, scheduler } = harness();
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    await scheduler.run(newer, [DOMAIN.queue], async (fence) => {
      fence.markApplied(); // two of three videos were queued before the third was refused
      return refuse(REFUSAL_REASON.noSuchVideo, 'The third video does not exist.');
    });
    const r = await scheduler.run(older, [DOMAIN.queue], async () => ok('older'));
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
  });

  it('a tool touching two domains is fenced by both (playback.next advances the queue)', async () => {
    const { commands, scheduler, applied, act } = harness();
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    await scheduler.run(newer, [DOMAIN.queue], act('queue change'));
    const r = await scheduler.run(older, [DOMAIN.playback, DOMAIN.queue], act('next'));
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
    expect(applied).toEqual(['queue change']);
  });

  it('suspension during preparation: a newer command that applies first overtakes the older on resume', async () => {
    const { commands, scheduler, applied } = harness();
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    const confirmation = gate();
    // The older command waits for a person's confirmation BEFORE taking its domain.
    const olderRun = (async () => {
      await confirmation.opened;
      return scheduler.run(older, [DOMAIN.catalogCuration], async () => {
        applied.push('older');
        return ok('older');
      });
    })();
    await scheduler.run(newer, [DOMAIN.catalogCuration], async () => {
      applied.push('newer');
      return ok('newer');
    });
    confirmation.open();
    const r = await olderRun;
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
    expect(applied).toEqual(['newer']);
  });

  it('an action that throws releases its domain, so later commands still run', async () => {
    // The global chain once stayed rejected after one bad handler, disabling
    // voice, typing and every button until reload (Gate C). The lane must not.
    const { commands, scheduler, applied, act } = harness();
    const boom = scheduler.run(commands.issue('manual'), [DOMAIN.playback], async () => {
      throw new Error('handler exploded');
    });
    await expect(boom).rejects.toThrow(/handler exploded/);
    expect(await scheduler.run(commands.issue('manual'), [DOMAIN.playback], act('after'))).toEqual(ok('after'));
    expect(applied).toEqual(['after']);
  });

  it('within a domain, placement order is application order, whoever is slow', async () => {
    const { commands, scheduler, applied, act } = harness();
    const holder = commands.issue('manual');
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    const slow = gate();
    const h = scheduler.run(holder, [DOMAIN.playback], act('holder', slow.opened));
    const o = scheduler.run(older, [DOMAIN.playback], act('older'));
    // `newer` also queues behind the holder, after `older`; applied order is by placement.
    const n = scheduler.run(newer, [DOMAIN.playback], act('newer'));
    slow.open();
    await Promise.all([h, o, n]);
    expect(applied).toEqual(['holder', 'older', 'newer']);
  });
});
