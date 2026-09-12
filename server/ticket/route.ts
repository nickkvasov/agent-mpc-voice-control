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
  used: boolean;
}

const issued = new Map<string, Ticket>();

export function mintTicket(gatewayOrigin: string): { url: string } {
  const token = randomUUID();
  issued.set(token, { token, expiresAt: Date.now() + TICKET_TTL_MS, used: false });
  return { url: `${gatewayOrigin}/mcp?ticket=${token}` };
}

export type TicketCheck =
  | { readonly ok: true }
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
  return { ok: true };
}

/** Exposed for tests; there is no other way to observe the store. */
export function __resetTickets(): void {
  issued.clear();
}
