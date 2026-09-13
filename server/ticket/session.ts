import { randomUUID } from 'node:crypto';

/**
 * The anonymous assistant session (FR-042, research R8).
 *
 * An opaque id in an HttpOnly, SameSite=Strict cookie set by the ticket
 * endpoint. The ticket records the session, so the socket it admits is bound
 * to it, and a turn reaches only the socket of the session whose cookie it
 * carries. A tab id the page might report is routing metadata and never admits
 * anything — otherwise any page could post a turn and drive someone else's tab.
 */
export const SESSION_COOKIE = 'vvc_session';

const SESSION_ID = /^[0-9a-f-]{36}$/;

export function sessionFromCookieHeader(header: string | undefined): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      // An unrecognisable value is no session, not a session named by the caller.
      return SESSION_ID.test(value) ? value : null;
    }
  }
  return null;
}

export function newSessionId(): string {
  return randomUUID();
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/api`;
}
