import { nextMidnightPacific } from '../time/pacific-day.ts';

/**
 * Bounds assistant spend in an anonymous deployment (FR-046, research R8).
 *
 * A per-session limit and a deployment-wide daily limit, both checked before
 * a turn starts. The daily limit is the real bound on spend; the per-session
 * one keeps a single sitting from using up everyone's day — the same reason the
 * search budget paces rather than only counts. Admission is one synchronous
 * decision, so concurrent turn starts cannot overspend between a check and a
 * count.
 *
 * Counts live in memory and reset when the process restarts, like the search
 * budget; so the day's remaining count is unknown until established.
 */
export interface AllowanceLimits {
  readonly perSession: number;
  readonly perDay: number;
}

export interface AllowanceSnapshot {
  readonly sessionTurnsRemaining: number;
  /** `null` until the day's prior usage is established (Constitution IV). */
  readonly dayTurnsRemaining: number | null;
  readonly resetsAt: number;
}

export type Admission =
  | { readonly ok: true; readonly snapshot: AllowanceSnapshot }
  | { readonly ok: false; readonly limit: 'session' | 'day'; readonly resetsAt: number; readonly detail: string };

const DEFAULTS: AllowanceLimits = { perSession: 40, perDay: 400 };

export class AssistantAllowance {
  readonly #limits: AllowanceLimits;
  readonly #sessions = new Map<string, number>();
  #day = 0;
  #established = false;
  #resetsAt: number;

  constructor(limits: AllowanceLimits = DEFAULTS, now: number = Date.now()) {
    this.#limits = limits;
    this.#resetsAt = nextMidnightPacific(now);
  }

  static limitsFrom(env: Readonly<Record<string, string | undefined>>): AllowanceLimits {
    const read = (name: string, fallback: number): number => {
      const raw = env[name];
      if (raw === undefined || raw.trim() === '') return fallback;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        // A limit that parses to nothing would silently become "no limit" or "no turns".
        throw new Error(`${name} must be a positive whole number, not ${JSON.stringify(raw)}`);
      }
      return n;
    };
    return {
      perSession: read('ASSISTANT_TURNS_PER_SESSION', DEFAULTS.perSession),
      perDay: read('ASSISTANT_TURNS_PER_DAY', DEFAULTS.perDay),
    };
  }

  /** Counted when admitted, not when the turn succeeds: a cancelled turn still spent its start. */
  admit(sessionId: string, now: number = Date.now()): Admission {
    this.#rollover(now);
    if (this.#day >= this.#limits.perDay) {
      return {
        ok: false, limit: 'day', resetsAt: this.#resetsAt,
        detail: `The assistant has been used ${String(this.#limits.perDay)} times today across everyone using this deployment. Everything here still works by hand.`,
      };
    }
    const used = this.#sessions.get(sessionId) ?? 0;
    if (used >= this.#limits.perSession) {
      return {
        ok: false, limit: 'session', resetsAt: this.#resetsAt,
        detail: `This session has used its ${String(this.#limits.perSession)} assistant turns. Everything here still works by hand.`,
      };
    }
    this.#sessions.set(sessionId, used + 1);
    this.#day += 1;
    return { ok: true, snapshot: this.snapshot(sessionId, now) };
  }

  snapshot(sessionId: string, now: number = Date.now()): AllowanceSnapshot {
    this.#rollover(now);
    return {
      sessionTurnsRemaining: Math.max(0, this.#limits.perSession - (this.#sessions.get(sessionId) ?? 0)),
      dayTurnsRemaining: this.#established ? Math.max(0, this.#limits.perDay - this.#day) : null,
      resetsAt: this.#resetsAt,
    };
  }

  restoreDay(used: number, now: number = Date.now()): void {
    this.#rollover(now);
    this.#day = used;
    this.#established = true;
  }

  #rollover(now: number): void {
    if (now < this.#resetsAt) return;
    this.#day = 0;
    this.#sessions.clear();
    this.#established = true;
    this.#resetsAt = nextMidnightPacific(now);
  }
}
