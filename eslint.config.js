import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', '.remember', 'specs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Spike probes and the Gate B driver are plain .mjs that run in Node and
    // evaluate code inside a real browser page, so they legitimately touch both
    // sets of globals.
    // Declared rather than ignored: these files are kept to be re-run, and an
    // ignored file is one the gate stops protecting.
    files: ['spikes/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
);
