import { AgentMcpProvider } from 'agent-mcp-react';
import { createAjvValidator } from 'agent-mcp-react/validation';
import type { ReactNode } from 'react';
import { ActivityRecorder, createInMemoryActivityStore } from '../activity/record-writer.ts';
import { CAPABILITIES } from './capabilities.ts';

/**
 * T020 — the provider wiring.
 *
 * Two things here are decisions rather than configuration:
 *
 * 1. `capabilities` comes from the frozen CAPABILITIES export, so no call site
 *    can widen it. DOM and evaluate stay off permanently (Constitution II).
 *
 * 2. The activity record is fed by the provider's observer callbacks, NOT by
 *    wrapping handlers. A handler wrapper cannot see a call refused before the
 *    handler ran — schema-invalid arguments — and running both would write two
 *    entries for one call. See the codex consult in NOTES.md (2026-09-12).
 */
export const recorder = new ActivityRecorder(createInMemoryActivityStore());

export interface McpRootProps {
  readonly children: ReactNode;
  /** Fetches an opaque, single-use connection URL. Never parsed here. */
  readonly getTicketUrl: () => Promise<string>;
}

export function McpRoot({ children, getTicketUrl }: McpRootProps) {
  return (
    <AgentMcpProvider
      connection={{ getUrl: getTicketUrl }}
      server={{ name: 'voice-video-control', version: '0.1.0' }}
      capabilities={CAPABILITIES}
      validation={{ validator: createAjvValidator() }}
      onUnexpectedState={(failure) => {
        // Reported, never swallowed. This is the operator's channel for broken
        // invariants; a silent catch here is the defect this whole design is
        // written against (IMMUNE-U).
        console.error('[mcp] unexpected state', failure);
      }}
    >
      {children}
    </AgentMcpProvider>
  );
}
