import { randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * POST /api/mcp-ticket — mints a single-use, short-lived connection URL.
 *
 * The URL is opaque to the browser by contract: never parsed, amended or
 * stored. Single use is enforced here rather than trusted, because a replayed
 * ticket is the one failure that would let a stale tab drive the application.
 */
const TICKET_TTL_MS = 30_000;

interface Ticket {
  readonly token: string;
  readonly expiresAt: number;
  /** The session the socket this ticket admits is bound to (R8). */
  readonly sessionId: string;
  /** Which tab of that session — routing metadata, never a credential. */
  readonly tabId: string;
  used: boolean;
}

const issued = new Map<string, Ticket>();

export function mintTicket(gatewayOrigin: string, sessionId: string, tabId: string): { url: string } {
  // Prune on issuance. Found at Gate C: without this the map retained every
  // ticket ever minted, so a long-running service grew on each reconnect
  // despite the 30-second lifetime.
  pruneExpired();
  const token = randomUUID();
  issued.set(token, { token, expiresAt: Date.now() + TICKET_TTL_MS, sessionId, tabId, used: false });
  return { url: `${gatewayOrigin}/mcp?ticket=${token}` };
}

export type TicketCheck =
  | { readonly ok: true; readonly sessionId: string; readonly tabId: string }
  | { readonly ok: false; readonly reason: 'unknown' | 'expired' | 'replayed' };

export function redeemTicket(token: string): TicketCheck {
  const t = issued.get(token);
  if (t === undefined) return { ok: false, reason: 'unknown' };
  // Constant-time compare so a token cannot be probed byte by byte.
  const a = Buffer.from(t.token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'unknown' };
  if (t.used) return { ok: false, reason: 'replayed' };
  if (Date.now() > t.expiresAt) return { ok: false, reason: 'expired' };
  t.used = true;
  return { ok: true, sessionId: t.sessionId, tabId: t.tabId };
}

function pruneExpired(now: number = Date.now()): void {
  for (const [token, t] of issued) {
    if (t.used || now > t.expiresAt) issued.delete(token);
  }
}

/** Exposed for tests; there is no other way to observe the store. */
export function __resetTickets(): void {
  issued.clear();
}

/** Exposed for tests; the store is otherwise unobservable. */
export function __ticketCount(): number {
  return issued.size;
}
