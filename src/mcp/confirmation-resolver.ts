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
 * A bulk action must have its count confirmed, not merely approved (FR-027):
 * "yes" to "delete 40 things?" is not enough, because a person who misheard the
 * number would say it just as readily.
 *
 * Confirmed when the response contains the exact count AND is otherwise
 * affirmative — or is the bare count, which confirms the number on its own.
 * Everything else refuses.
 */
export function resolveCountedConfirmation(response: string | null | undefined, count: number): ConfirmationOutcome {
  if (typeof response !== 'string') return 'refused';
  const words = response.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  if (!words.includes(String(count))) return 'refused';
  if (words.length === 1) return 'confirmed';
  const hasNegation = words.some((w) => w === 'no' || w === 'not' || w === 'cancel' || w === 'stop' || w === 'wait');
  if (hasNegation) return 'refused';
  return words.some((w) => AFFIRMATIVE.has(w)) ? 'confirmed' : 'refused';
}
