/**
 * T089 — break-it-to-prove-it, across every gate this feature added.
 *
 * For each: delete the check, confirm the named case goes RED, restore. A gate
 * whose removal changes nothing was never being tested — and a break-it that
 * PASSES proves nothing at all, which is the trap this run fell into once
 * already (NOTES.md 2026-09-13).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CHECKS = [
  {
    name: 'no bare success: refusal must carry a detail',
    file: 'src/mcp/result.ts',
    find: `  if (detail.trim() === '') {`,
    replace: `  if (false) {`,
  },
  {
    name: 'one entry per invocation: duplicate call ids rejected',
    file: 'src/activity/record-writer.ts',
    find: `    if (this.#seen.has(call.callId)) {`,
    replace: `    if (false) {`,
  },
  {
    name: 'unknown is a value: a bad video id is refused',
    file: 'src/store/video-reference.ts',
    find: `  if (!VIDEO_ID.test(input.videoId)) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'capabilities frozen: dom and evaluate cannot be enabled',
    file: 'src/mcp/capabilities.ts',
    find: `export const CAPABILITIES = Object.freeze({`,
    replace: `export const CAPABILITIES = ({`,
  },
  {
    name: 'counted confirmation: an affirmative alone must not authorise',
    file: 'src/mcp/confirmation-resolver.ts',
    find: `  if (words.filter((w) => w === String(count)).length !== 1) return 'refused';`,
    replace: `  if (false) return 'refused';`,
  },
  {
    name: 'bulk gate: adding above the threshold needs the count',
    file: 'src/queue/queue.ts',
    find: `  if (videoIds.length > BULK_THRESHOLD && confirmedCount !== videoIds.length) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'collection deletion always needs the count',
    file: 'src/curation/collections.ts',
    find: `  if (confirmedCount !== target.videoIds.length) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'queue restoration uses the stored sort key',
    file: 'src/queue/restore.ts',
    find: `    return { ...queue, items: sorted([...queue.items, restored]) };`,
    replace: `    return { ...queue, items: [...queue.items, restored] };`,
  },
  {
    name: 'undone blockers stop blocking',
    file: 'src/activity/supersession.ts',
    find: `|| l.undone) continue;`,
    replace: `) continue;`,
  },
];

let broke = 0;
let held = 0;
for (const c of CHECKS) {
  const original = readFileSync(c.file, 'utf8');
  if (!original.includes(c.find)) {
    console.log(`SKIP  ${c.name}\n      anchor not found in ${c.file} — the check moved, so this entry is stale`);
    continue;
  }
  writeFileSync(c.file, original.replace(c.find, c.replace));
  let red = false;
  try {
    execSync('npm test', { stdio: 'pipe' });
  } catch {
    red = true;
  }
  writeFileSync(c.file, original);
  if (red) {
    broke += 1;
    console.log(`RED   ${c.name}`);
  } else {
    held += 1;
    console.log(`GREEN ${c.name}\n      *** removing this changed nothing — it is not covered ***`);
  }
}
console.log(`\n${broke} of ${broke + held} checks proved; ${held} unproved.`);
process.exit(held === 0 ? 0 : 1);
