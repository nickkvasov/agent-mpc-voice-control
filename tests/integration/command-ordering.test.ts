import { describe, expect, it } from 'vitest';

/**
 * FR-038: commands apply in the order ISSUED.
 *
 * Gate C found that a spoken command whose transcript resolved late could be
 * applied AFTER a click the person made later, overriding it. The fix reserves
 * each command's place when it is issued; this models that chain directly.
 */
function makeChain() {
  let chain: Promise<void> = Promise.resolve();
  const applied: string[] = [];
  const enqueue = (resolveText: () => Promise<string>): void => {
    chain = chain.then(async () => {
      const text = await resolveText();
      if (text.trim() === '') return;
      applied.push(text);
    });
  };
  return { enqueue, applied, done: () => chain };
}

describe('command ordering', () => {
  it('applies a slow spoken command before a later click', async () => {
    const { enqueue, applied, done } = makeChain();
    // Released first, but its transcript takes 40ms to finalise.
    enqueue(() => new Promise((r) => setTimeout(() => r('pause'), 40)));
    // Clicked during that gap.
    enqueue(() => Promise.resolve('play'));
    await done();
    expect(applied).toEqual(['pause', 'play']);
  });

  it('keeps order across several mixed-latency commands', async () => {
    const { enqueue, applied, done } = makeChain();
    enqueue(() => new Promise((r) => setTimeout(() => r('one'), 30)));
    enqueue(() => Promise.resolve('two'));
    enqueue(() => new Promise((r) => setTimeout(() => r('three'), 5)));
    await done();
    expect(applied).toEqual(['one', 'two', 'three']);
  });

  it('drops an empty transcript without disturbing the order', async () => {
    const { enqueue, applied, done } = makeChain();
    enqueue(() => Promise.resolve('first'));
    enqueue(() => Promise.resolve('   '));
    enqueue(() => Promise.resolve('second'));
    await done();
    expect(applied).toEqual(['first', 'second']);
  });
});
