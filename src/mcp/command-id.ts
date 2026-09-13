import type { ToolName } from '../vocab/tool-names.ts';
import { BUSINESS_SCHEMAS, type ObjectSchema } from './tool-schemas.ts';

/**
 * The reserved attribution field (research R7).
 *
 * `agent-mcp-react` 0.3.0 hands a tool handler no request metadata, so an
 * arriving call cannot say which command it serves. Every tool's wire schema
 * therefore carries `commandId`: added here, removed here, defined nowhere
 * else. The backend imports this module rather than restating the name, and
 * strips the field from what the model sees before writing the turn's own id
 * into every call — the model can neither choose nor forge it.
 *
 * Pure: no DOM, no React, so the backend can import it directly.
 */
export const COMMAND_ID_FIELD = 'commandId';

const COMMAND_ID_SCHEMA = {
  type: 'string',
  minLength: 1,
  description: 'Reserved. Written by the application; never supplied by a model.',
} as const;

/** What the page declares: the business schema plus the reserved field. */
export function wireSchema(tool: ToolName): ObjectSchema {
  const business = BUSINESS_SCHEMAS[tool];
  if (COMMAND_ID_FIELD in business.properties) {
    throw new Error(`${tool} uses the reserved field name ${COMMAND_ID_FIELD}`);
  }
  return {
    ...business,
    properties: { ...business.properties, [COMMAND_ID_FIELD]: COMMAND_ID_SCHEMA },
    required: [...business.required, COMMAND_ID_FIELD],
  };
}

/** What a model is shown: exactly the wire schema without the reserved field. */
export function modelSchema(wire: { readonly properties?: unknown; readonly required?: unknown }): ObjectSchema {
  const properties = { ...((wire.properties ?? {}) as Record<string, unknown>) };
  delete properties[COMMAND_ID_FIELD];
  const required = Array.isArray(wire.required) ? (wire.required as string[]).filter((r) => r !== COMMAND_ID_FIELD) : [];
  return { ...(wire as unknown as ObjectSchema), properties, required };
}

/** Splits an arriving call into its attribution and the input a handler sees. */
export function withoutCommandId(args: Record<string, unknown>): { commandId: string | null; input: Record<string, unknown> } {
  const { [COMMAND_ID_FIELD]: raw, ...input } = args;
  return { commandId: typeof raw === 'string' ? raw : null, input };
}
