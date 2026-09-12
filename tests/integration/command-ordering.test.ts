import { describe, expect, it } from 'vitest';
import { CommandChain } from '../../src/app/command-chain.ts';

/**
 * FR-038: commands apply in the order ISSUED.
 *
 * These drive the PRODUCTION CommandChain. The previous version of this file
 * reimplemented the chain inside the test, so deleting the real fix left every
 * case green — an assertion that could not fail, which is what the
 * break-it-to-prove-it rule exists to catch (Gate C).
 */
describe('command ordering', () => {
  const applyInto = (out: string[]) => (text: string) => void out.push(text);

  it('applies a slow spoken command before a later click', async () => {
    const applied: string[] = [];
    const chain = new CommandChain();
    // Released first, but its transcript takes 40ms to finalise.
    chain.enqueue(() => new Promise((r) => setTimeout(() => r('pause'), 40)), applyInto(applied));
    // Clicked during that gap.
    chain.enqueue(() => Promise.resolve('play'), applyInto(applied));
    await chain.settled();
    expect(applied).toEqual(['pause', 'play']);
  });

  it('keeps order across several mixed-latency commands', async () => {
    const applied: string[] = [];
    const chain = new CommandChain();
    chain.enqueue(() => new Promise((r) => setTimeout(() => r('one'), 30)), applyInto(applied));
    chain.enqueue(() => Promise.resolve('two'), applyInto(applied));
    chain.enqueue(() => new Promise((r) => setTimeout(() => r('three'), 5)), applyInto(applied));
    await chain.settled();
    expect(applied).toEqual(['one', 'two', 'three']);
  });

  it('drops an empty transcript without disturbing the order', async () => {
    const applied: string[] = [];
    const chain = new CommandChain();
    chain.enqueue(() => Promise.resolve('first'), applyInto(applied));
    chain.enqueue(() => Promise.resolve('   '), applyInto(applied));
    chain.enqueue(() => Promise.resolve('second'), applyInto(applied));
    await chain.settled();
    expect(applied).toEqual(['first', 'second']);
  });

  it('survives a command that throws instead of disabling every later one', async () => {
    // invokeRecorded rethrows handler errors, so one bad handler used to leave
    // the chain permanently rejected — voice, typing and buttons all dead.
    const applied: string[] = [];
    const errors: unknown[] = [];
    const chain = new CommandChain({ onError: (c) => errors.push(c) });
    chain.enqueue(() => Promise.resolve('boom'), () => {
      throw new Error('handler exploded');
    });
    chain.enqueue(() => Promise.resolve('after'), applyInto(applied));
    await chain.settled();
    expect(applied).toEqual(['after']);
    expect(String(errors[0])).toMatch(/handler exploded/);
  });

  it('survives a transcript that rejects', async () => {
    const applied: string[] = [];
    const errors: unknown[] = [];
    const chain = new CommandChain({ onError: (c) => errors.push(c) });
    chain.enqueue(() => Promise.reject(new Error('recognition failed')), applyInto(applied));
    chain.enqueue(() => Promise.resolve('still works'), applyInto(applied));
    await chain.settled();
    expect(applied).toEqual(['still works']);
    expect(errors).toHaveLength(1);
  });
});
