#!/usr/bin/env node
/**
 * Backend and Vite as one process group (T092).
 *
 * The live gate needs both: a page whose /api proxy points at nothing looks
 * like a working app and answers every search with the SPA's own HTML — the
 * exact incident in NOTES.md. So they start together and stop together, and a
 * child that dies takes the other with it rather than leaving a half-stack that
 * still answers on one port (IMMUNE-U).
 *
 * Children are spawned directly, not through `npm run`: npm interposes a shell,
 * and signalling it does not reach the node process underneath.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const children = [
  {
    name: 'backend',
    child: spawn(
      process.execPath,
      ['--env-file-if-exists=dev.env', '--env-file-if-exists=.env', 'server/index.ts'],
      { cwd: root, stdio: 'inherit' },
    ),
  },
  {
    name: 'vite',
    child: spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js')], { cwd: root, stdio: 'inherit' }),
  },
];

let stopping = false;

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

for (const { name, child } of children) {
  child.on('error', (cause) => {
    process.stderr.write(`[dev-all] ${name} could not start: ${String(cause)}\n`);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    // Only a stop this launcher started is clean. A child that exits on its
    // own — even with code 0, even by SIGTERM from outside — has taken half the
    // stack down, and reporting that as success is the silent pass this script
    // exists to prevent.
    if (stopping) return;
    process.stderr.write(`[dev-all] ${name} exited (${signal ?? `code ${String(code)}`}); stopping the other\n`);
    stopAll(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0));
}
