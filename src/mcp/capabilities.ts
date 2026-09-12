/**
 * The capability declaration handed to AgentMcpProvider.
 *
 * Constitution II: DOM manipulation and script evaluation stay off permanently.
 * Either one would give the agent a second way to change the application that
 * bypasses the tool contract, the confirmation gates and the activity record —
 * three requirements defeated at once, with no code appearing to change.
 *
 * Frozen, and exported as the single owner so no call site can pass its own.
 */
export const CAPABILITIES = Object.freeze({
  application: true,
  dom: Object.freeze({ inspect: false, interact: false }),
  evaluate: false,
} as const);

export type Capabilities = typeof CAPABILITIES;
