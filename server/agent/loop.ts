import Anthropic from '@anthropic-ai/sdk';

/**
 * The agent host.
 *
 * Runs server-side so the browser never holds a key. The page's only contact
 * with the agent is the socket it opens with a ticket from /api/mcp-ticket.
 *
 * Streaming is not a nicety: the agent's progress is what the person watches
 * during SC-012's three-second window.
 */
export const AGENT_MODEL = 'claude-opus-5';

export interface AgentHostConfig {
  readonly apiKey: string;
  /** Kept out of the constructor so tests can drive the loop without a network. */
  readonly client?: Anthropic;
}

export function createClient(config: AgentHostConfig): Anthropic {
  if (config.client !== undefined) return config.client;
  if (config.apiKey.trim() === '') {
    // An unkeyed client would fail at the first call, far from the cause, and
    // the page would show "assistant unavailable" with no reason anyone can act
    // on (IMMUNE-U).
    throw new Error('ANTHROPIC_API_KEY is empty; the agent host cannot start');
  }
  return new Anthropic({ apiKey: config.apiKey });
}

export const AGENT_REQUEST_DEFAULTS = {
  model: AGENT_MODEL,
  max_tokens: 8192,
  thinking: { type: 'adaptive' },
} as const;
