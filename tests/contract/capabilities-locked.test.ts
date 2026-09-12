import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../../src/mcp/capabilities.ts';

/** T021 — Constitution II. */
describe('capabilities are locked off', () => {
  it('dom inspect and interact are off, and evaluate is off', () => {
    expect(CAPABILITIES.dom.inspect).toBe(false);
    expect(CAPABILITIES.dom.interact).toBe(false);
    expect(CAPABILITIES.evaluate).toBe(false);
  });

  it('cannot be enabled by configuration at runtime', () => {
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(CAPABILITIES.dom)).toBe(true);
    expect(() => {
      (CAPABILITIES as { evaluate: boolean }).evaluate = true;
    }).toThrow();
    expect(CAPABILITIES.evaluate).toBe(false);
  });

  it('application tools remain enabled', () => {
    expect(CAPABILITIES.application).toBe(true);
  });
});
