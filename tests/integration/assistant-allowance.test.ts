import { describe, expect, it } from 'vitest';
import { AssistantAllowance } from '../../server/assistant/allowance.ts';
import { nextMidnightPacific } from '../../server/time/pacific-day.ts';
import { SearchBudget } from '../../server/catalog-proxy/budget.ts';

/** T126 — FR-046, research R8. */
const T0 = Date.UTC(2026, 8, 14, 18, 0, 0); // 11:00 Pacific (PDT)

describe('assistant allowance', () => {
  it('admits until the per-session limit, then refuses naming that limit and when it resets', () => {
    const a = new AssistantAllowance({ perSession: 2, perDay: 10 }, T0);
    expect(a.admit('s1', T0).ok).toBe(true);
    expect(a.admit('s1', T0).ok).toBe(true);
    const third = a.admit('s1', T0);
    expect(third).toMatchObject({ ok: false, limit: 'session', resetsAt: nextMidnightPacific(T0) });
    // Another session is unaffected by the first one's limit.
    expect(a.admit('s2', T0).ok).toBe(true);
  });

  it('refuses every session once the deployment-wide daily limit is reached', () => {
    const a = new AssistantAllowance({ perSession: 5, perDay: 3 }, T0);
    for (const s of ['a', 'b', 'c']) expect(a.admit(s, T0).ok).toBe(true);
    expect(a.admit('d', T0)).toMatchObject({ ok: false, limit: 'day' });
  });

  it('concurrent starts cannot overspend: admission is one synchronous decision each', async () => {
    const a = new AssistantAllowance({ perSession: 100, perDay: 5 }, T0);
    const results = await Promise.all(Array.from({ length: 20 }, async (_, i) => a.admit(`s${String(i)}`, T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it('rolls over at the same Pacific midnight the search budget uses', () => {
    const a = new AssistantAllowance({ perSession: 1, perDay: 1 }, T0);
    expect(a.admit('s1', T0).ok).toBe(true);
    expect(a.admit('s1', T0).ok).toBe(false);
    const nextDay = nextMidnightPacific(T0) + 1000;
    expect(a.admit('s1', nextDay).ok).toBe(true);
    // One definition of a day: a fresh allowance and a fresh search budget reset together.
    expect(new AssistantAllowance({ perSession: 1, perDay: 1 }, T0).snapshot('x', T0).resetsAt).toBe(new SearchBudget(T0).snapshot(T0).resetsAt);
  });

  it('reports remaining turns, with the day unknown until established — like the search budget', () => {
    const fresh = new AssistantAllowance({ perSession: 40, perDay: 400 }, T0);
    fresh.admit('s1', T0);
    expect(fresh.snapshot('s1', T0)).toMatchObject({ sessionTurnsRemaining: 39, dayTurnsRemaining: null });
    // Restored at startup, before any turn — it replaces the day's count, as SearchBudget.restore does.
    const restored = new AssistantAllowance({ perSession: 40, perDay: 400 }, T0);
    restored.restoreDay(100, T0);
    restored.admit('s1', T0);
    expect(restored.snapshot('s1', T0)).toMatchObject({ dayTurnsRemaining: 299 });
  });

  it('reads its limits from the environment, refusing values that are not positive integers', () => {
    expect(AssistantAllowance.limitsFrom({ ASSISTANT_TURNS_PER_SESSION: '12', ASSISTANT_TURNS_PER_DAY: '99' })).toEqual({ perSession: 12, perDay: 99 });
    expect(AssistantAllowance.limitsFrom({})).toEqual({ perSession: 40, perDay: 400 });
    expect(() => AssistantAllowance.limitsFrom({ ASSISTANT_TURNS_PER_DAY: 'lots' })).toThrow(/ASSISTANT_TURNS_PER_DAY/);
    expect(() => AssistantAllowance.limitsFrom({ ASSISTANT_TURNS_PER_SESSION: '0' })).toThrow(/ASSISTANT_TURNS_PER_SESSION/);
  });
});
