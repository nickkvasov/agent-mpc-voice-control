import { describe, expect, it } from 'vitest';
import { createInMemoryStores, OBJECT_STORES } from '../../src/store/db.ts';
import { openStores } from '../../src/store/indexeddb.ts';

describe('persistence boundary', () => {
  it('declares every store the data model names, commands included', () => {
    expect([...OBJECT_STORES]).toContain('commands');
    const s = createInMemoryStores();
    expect(Object.keys(s).sort()).toEqual([...OBJECT_STORES].sort());
  });

  it('lets the person clear command history (FR-041)', async () => {
    const s = createInMemoryStores();
    await s.commands.append({
      commandId: 'c1', modality: 'voice', rawText: 'pause', interpretation: 'pause playback',
      route: 'local_matcher', receivedAt: 0, outcome: 'applied', refusalReason: null,
    });
    expect(await s.commands.all()).toHaveLength(1);
    await s.commands.clear();
    expect(await s.commands.all()).toHaveLength(0);
  });

  it('reports non-durability rather than silently falling back to memory', async () => {
    const outcome = await openStores(undefined);
    expect(outcome.ok).toBe(true);
    expect(outcome.durable).toBe(false);
    if (!outcome.durable) expect(outcome.reason).toMatch(/survive a reload/);
  });

  it('reports the reason when the database will not open', async () => {
    const broken = {
      open: () => {
        const req: Record<string, unknown> = { error: new Error('blocked by policy') };
        queueMicrotask(() => (req['onerror'] as () => void)());
        return req;
      },
    } as unknown as IDBFactory;
    const outcome = await openStores(broken);
    expect(outcome.durable).toBe(false);
    if (!outcome.durable) expect(outcome.reason).toMatch(/blocked by policy/);
  });
});
