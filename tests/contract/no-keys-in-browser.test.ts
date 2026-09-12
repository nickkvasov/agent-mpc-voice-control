import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T027 — credentials never reach the browser.
 *
 * Asserts against the BUILT bundle, not the source. Vite inlines any variable
 * prefixed VITE_; a key that leaked through a rename would be invisible in the
 * source and plainly present here.
 */
describe('no credentials in the browser bundle', () => {
  it('neither key name nor a key-shaped value appears in dist/', () => {
    // Always build the current revision. Found at Gate C: reusing an existing
    // dist scans the PREVIOUS build, and because the fast gate runs tests before
    // build, a credential leak introduced after a clean build would pass this
    // check and then be emitted unexamined.
    rmSync('dist', { recursive: true, force: true });
    execSync('npm run build', { stdio: 'ignore' });

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|css|html|map)$/.test(e.name)) files.push(p);
      }
    };
    walk('dist');
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, `${f} names a server-only variable`).not.toMatch(/ANTHROPIC_API_KEY|YOUTUBE_API_KEY/);
      expect(text, `${f} contains an Anthropic-shaped key`).not.toMatch(/sk-ant-[A-Za-z0-9_-]{10}/);
      expect(text, `${f} contains a Google-shaped key`).not.toMatch(/AIza[A-Za-z0-9_-]{30}/);
    }
  });
});
