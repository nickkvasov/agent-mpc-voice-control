import { createContext, useContext, type ReactNode } from 'react';
import { useMcpTool } from 'agent-mcp-react';
import type { CommandRegistry } from '../app/commands.ts';
import type { ToolActions } from '../app/tool-actions.ts';
import { invokeRecorded } from '../app/invoke.ts';
import { recorder } from '../activity/recorder.ts';
import { handlerStarts } from '../activity/handler-starts.ts';
import { wireSchema, withoutCommandId } from './command-id.ts';
import { TOOL_DESCRIPTIONS, toolLabel } from './tool-descriptions.ts';
import type { ToolName } from '../vocab/tool-names.ts';

/**
 * Registers tools with MCP from the view that shows them (Principle II, FR-035).
 *
 * A view renders `<DeclaredTools tools={…} />`; while it is mounted those tools
 * exist, and when it unmounts they are gone. One component per tool, so no hook
 * is called in a loop.
 *
 * Every handler resolves the reserved `commandId` to the page's own command
 * record and calls the same action a button calls. A call whose command is
 * unknown, cancelled or finished is refused — and recorded, because it reached
 * a handler and the observer records only calls that did not (research R7).
 */
export interface ToolSurface {
  readonly actions: ToolActions;
  readonly commands: CommandRegistry;
}

const ToolSurfaceContext = createContext<ToolSurface | null>(null);

export function ToolSurfaceProvider({ surface, children }: { surface: ToolSurface; children: ReactNode }) {
  return <ToolSurfaceContext.Provider value={surface}>{children}</ToolSurfaceContext.Provider>;
}

export function DeclaredTools({ tools }: { tools: readonly ToolName[] }) {
  return (
    <>
      {tools.map((tool) => (
        <DeclaredTool key={tool} tool={tool} />
      ))}
    </>
  );
}

function DeclaredTool({ tool }: { tool: ToolName }) {
  const surface = useContext(ToolSurfaceContext);
  if (surface === null) {
    // A view rendered outside the surface would register nothing and look fine.
    throw new Error(`${tool} was declared outside ToolSurfaceProvider`);
  }
  useMcpTool({
    name: tool,
    description: TOOL_DESCRIPTIONS[tool],
    inputSchema: wireSchema(tool),
    handler: async (args, context) => {
      handlerStarts.begin(tool, args, context.signal);
      try {
        const { commandId, input } = withoutCommandId(args);
        const resolved = surface.commands.resolveForCall(commandId ?? '');
        const result = resolved.ok
          ? // The call's own signal: it aborts when the agent cancels or this view
            // unmounts, and an action still waiting for its domain must then not apply.
            await surface.actions[tool](resolved.value, input, context.signal)
          : // Described as what was asked, in the interface's words; the view adds
            // "refused" and the detail names the command.
            await invokeRecorded(recorder, tool, input, `${toolLabel(tool)} (for a command that is not open)`, () => resolved, null, commandId);
        // The agent's next read must see what this call changed.
        await context.afterRender();
        return result;
      } finally {
        // After afterRender, so this matches when the library stamps the handler
        // complete — the fact the observer's matching rests on (handler-starts.ts).
        handlerStarts.settle(tool, args, context.signal);
      }
    },
  });
  return null;
}
