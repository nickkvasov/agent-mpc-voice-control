/**
 * Constitution VI: destruction confirms, ambiguity refuses.
 *
 * There is deliberately no "assume yes" path. Anything that is not an explicit,
 * unambiguous confirmation resolves to refusal (FR-028), because a misrecognised
 * utterance landing on a destructive command is the failure this system is most
 * able to cause and least able to excuse.
 */
export type ConfirmationOutcome = 'confirmed' | 'refused';

const AFFIRMATIVE: ReadonlySet<string> = new Set([
  'yes',
  'yeah',
  'yep',
  'confirm',
  'confirmed',
  'do it',
  'go ahead',
  'ok',
  'okay',
]);

/**
 * Resolves a spoken or typed response to a confirmation prompt.
 *
 * Anything not in the affirmative set — including silence, "maybe", "I think
 * so", or a number the person meant as something else — is a refusal.
 */
export function resolveConfirmation(response: string | null | undefined): ConfirmationOutcome {
  if (typeof response !== 'string') return 'refused';
  const normalized = response.trim().toLowerCase().replace(/[.!]+$/, '');
  return AFFIRMATIVE.has(normalized) ? 'confirmed' : 'refused';
}

/**
 * A bulk action must have its count confirmed, not merely approved (FR-027).
 *
 * The whole response is validated, not scanned for tokens. An earlier version
 * looked for an affirmative plus the count anywhere in the sentence, and
 * confirmed "yes but don't delete all 40" — "don't" tokenises to don + t, so a
 * negation blacklist missed it. Scanning for agreement inside a sentence cannot
 * establish consent; only the whole utterance can.
 *
 * Every word must be the count, an affirmative, or recognised filler. Anything
 * else refuses, because an unrecognised phrasing is an ambiguous one
 * (Constitution VI).
 */
const COUNTED_FILLER: ReadonlySet<string> = new Set(['all', 'of', 'them', 'the', 'please', 'delete', 'remove', 'that', 'those', 's']);

export function resolveCountedConfirmation(response: string | null | undefined, count: number): ConfirmationOutcome {
  if (typeof response !== 'string') return 'refused';
  const words = response.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  if (words.length === 0) return 'refused';
  if (!words.includes(String(count))) return 'refused';
  if (words.filter((w) => w === String(count)).length !== 1) return 'refused';

  let sawAffirmative = false;
  for (const w of words) {
    if (w === String(count)) continue;
    if (AFFIRMATIVE.has(w)) { sawAffirmative = true; continue; }
    if (COUNTED_FILLER.has(w)) continue;
    return 'refused';
  }
  // The bare count confirms the number on its own; otherwise an affirmative is required.
  return words.length === 1 || sawAffirmative ? 'confirmed' : 'refused';
}
