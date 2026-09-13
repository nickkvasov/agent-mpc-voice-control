/**
 * The product's one notion of "a day" (T129).
 *
 * The search allowance and the assistant allowance both reset here. Two copies
 * of this calculation could disagree about when a day ends — and the person
 * would see one budget reset while the other still said "spent" (IMMUNE-N).
 * YouTube's quota day is Pacific time, so that is the day.
 */
/** Midnight in America/Los_Angeles, computed rather than assuming UTC-8. */
export function nextMidnightPacific(now: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (t: number): Record<string, number> =>
    Object.fromEntries(fmt.formatToParts(t).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const p = parts(now);
  const since = ((p['hour'] ?? 0) % 24) * 3600 + (p['minute'] ?? 0) * 60 + (p['second'] ?? 0);
  let candidate = now + (86_400 - since) * 1000;
  const q = parts(candidate);
  const drift = ((q['hour'] ?? 0) % 24) * 3600 + (q['minute'] ?? 0) * 60 + (q['second'] ?? 0);
  if (drift !== 0) candidate -= drift * 1000;
  return candidate;
}
