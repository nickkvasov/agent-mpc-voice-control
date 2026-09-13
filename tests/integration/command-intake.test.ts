import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/app/commands.ts';
import { issueText } from '../../src/app/command-intake.ts';

/**
 * Migrated from command-ordering.test.ts when the global CommandChain was
 * retired (T102). Order and overtaking now live in issue-fence.test.ts; what
 * remains here is intake: when a command is issued, and what survives failure.
 */
describe('command intake', () => {
  it('issues the command when called, before its text exists', () => {
    const registry = new CommandRegistry();
    let resolve!: (t: string) => void;
    const spoken = issueText(registry, 'voice', () => new Promise((r) => { resolve = r; }), { run: async () => {}, failed: () => {} });
    const click = registry.issue('manual');
    expect(spoken.command.issueSeq).toBeLessThan(click.issueSeq);
    resolve('pause');
  });

  it('drops an empty transcript without running it, and still finishes the command', async () => {
    const registry = new CommandRegistry();
    const ran: string[] = [];
    const { command, settled } = issueText(registry, 'voice', () => Promise.resolve('   '), {
      run: async (_c, t) => void ran.push(t), failed: () => {},
    });
    await settled;
    expect(ran).toEqual([]);
    expect(registry.get(command.commandId)?.state).toBe('finished');
  });

  it('reports a transcript that rejects, and a later command still runs', async () => {
    const registry = new CommandRegistry();
    const failures: unknown[] = [];
    const ran: string[] = [];
    const cb = { run: async (_c: unknown, t: string) => void ran.push(t), failed: (_c: unknown, cause: unknown) => void failures.push(cause) };
    await issueText(registry, 'voice', () => Promise.reject(new Error('recognition failed')), cb).settled;
    await issueText(registry, 'text', () => Promise.resolve('still works'), cb).settled;
    expect(String(failures[0])).toMatch(/recognition failed/);
    expect(ran).toEqual(['still works']);
  });

  it('reports a run that throws instead of leaving the command open', async () => {
    const registry = new CommandRegistry();
    const failures: unknown[] = [];
    const { command, settled } = issueText(registry, 'text', () => Promise.resolve('boom'), {
      run: async () => { throw new Error('handler exploded'); },
      failed: (_c, cause) => void failures.push(cause),
    });
    await settled;
    expect(String(failures[0])).toMatch(/handler exploded/);
    expect(registry.get(command.commandId)?.state).toBe('finished');
  });
});
