import type { ToolTransport } from '../agent/loop.ts';
import { COMMAND_ID_FIELD, modelSchema } from '../../src/mcp/command-id.ts';

/**
 * The turn's command, attached to every call — and hidden from the model (research R7).
 *
 * `agent-mcp-react` gives a page handler no request metadata, so each tool's
 * wire schema carries a reserved `commandId`. Here the schema the model sees is
 * derived by removing exactly that field (the same derivation the page uses),
 * and every forwarded call gets the turn's id written OVER anything the model
 * produced: the model can neither choose nor forge which command it acts for.
 *
 * The loop never learns attribution exists; it only sees a transport.
 */
export function attributedTransport(page: ToolTransport, commandId: string): ToolTransport {
  return {
    async listTools() {
      const tools = await page.listTools();
      return tools.map((t) => ({ ...t, inputSchema: modelSchema(t.inputSchema) }));
    },
    callTool(name, input, signal) {
      const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      return page.callTool(name, { ...args, [COMMAND_ID_FIELD]: commandId }, signal);
    },
  };
}
