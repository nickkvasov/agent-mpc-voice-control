/**
 * The application's tools are named `playback.pause`. The Messages API requires
 * custom tool names to match ^[a-zA-Z0-9_-]{1,128}$, so a dot is rejected before
 * any tool runs.
 *
 * Found at Gate C, and worth noting how: every loop test passed, because a mock
 * client accepts any name. Only a reader who knew the API's constraint could
 * see it — which is the argument for the review gate in one example.
 */
const SEPARATOR = '__';

export class ToolNameCollision extends Error {}

export interface ToolNameMap {
  /** application name -> API-safe alias */
  readonly toApi: ReadonlyMap<string, string>;
  /** API-safe alias -> application name */
  readonly fromApi: ReadonlyMap<string, string>;
}

export function buildToolNameMap(names: readonly string[]): ToolNameMap {
  const toApi = new Map<string, string>();
  const fromApi = new Map<string, string>();
  for (const name of names) {
    const alias = name.replace(/[^a-zA-Z0-9_-]/g, SEPARATOR);
    const existing = fromApi.get(alias);
    if (existing !== undefined && existing !== name) {
      // Two application names collapsing to one alias would silently route a
      // call to the wrong tool. Refused loudly instead.
      throw new ToolNameCollision(`Tools ${existing} and ${name} both map to the API name ${alias}`);
    }
    if (alias.length > 128) {
      throw new ToolNameCollision(`Tool ${name} exceeds the 128-character API limit as ${alias}`);
    }
    toApi.set(name, alias);
    fromApi.set(alias, name);
  }
  return { toApi, fromApi };
}

export const API_TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;
