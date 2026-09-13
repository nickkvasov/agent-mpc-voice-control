import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { McpRoot } from './mcp/provider.tsx';

const root = document.getElementById('root');
// IMMUNE-U: a missing mount point is an unexpected state, not something to
// paper over with a silent return.
if (root === null) {
  throw new Error('Mount point #root is missing from index.html');
}

/**
 * The page's MCP connection URL comes from the backend, once per attempt, and
 * is never parsed here (contracts/backend-http.md). A refusal is thrown with
 * the backend's own reason, so the connection state can say why.
 */
async function getTicketUrl(): Promise<string> {
  const res = await fetch('/api/mcp-ticket', { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { url?: unknown; reason?: unknown; detail?: unknown };
  if (res.status !== 200 || typeof body.url !== 'string') {
    throw new Error(`No connection ticket (${String(res.status)}): ${typeof body.detail === 'string' ? body.detail : 'the backend gave no reason'}`);
  }
  return body.url;
}

// T104. Mounted at last: until Phase 9 the provider was written but never
// rendered, so the page published no tools at all (tasks.md, found after closeout).
createRoot(root).render(
  <StrictMode>
    <McpRoot getTicketUrl={getTicketUrl}>
      <App />
    </McpRoot>
  </StrictMode>,
);
