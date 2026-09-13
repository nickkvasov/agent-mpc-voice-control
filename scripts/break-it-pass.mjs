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
    expect: 'refuses to construct a refusal with no detail',
    file: 'src/mcp/result.ts',
    find: `  if (detail.trim() === '') {`,
    replace: `  if (false) {`,
  },
  {
    name: 'one entry per invocation: duplicate call ids rejected',
    expect: 'never writes two entries for one call',
    file: 'src/activity/record-writer.ts',
    find: `    if (this.#seen.has(call.callId)) {`,
    replace: `    if (false) {`,
  },
  {
    name: 'unknown is a value: a bad video id is refused',
    expect: 'refuses a malformed reference rather than storing it speculatively',
    file: 'src/store/video-reference.ts',
    find: `  if (!VIDEO_ID.test(input.videoId)) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'capabilities frozen: dom and evaluate cannot be enabled',
    expect: 'cannot be enabled by configuration at runtime',
    file: 'src/mcp/capabilities.ts',
    find: `export const CAPABILITIES = Object.freeze({`,
    replace: `export const CAPABILITIES = ({`,
  },
  {
    name: 'counted confirmation: an affirmative alone must not authorise',
    expect: 'requires the count to be said back for a bulk action',
    file: 'src/mcp/confirmation-resolver.ts',
    find: `  if (words.filter((w) => w === String(count)).length !== 1) return 'refused';`,
    replace: `  if (false) return 'refused';`,
  },
  {
    name: 'bulk gate: adding above the threshold needs the count',
    expect: 'requires confirmation above the bulk threshold',
    file: 'src/queue/queue.ts',
    find: `  if (videoIds.length > BULK_THRESHOLD && confirmedCount !== videoIds.length) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'collection deletion always needs the count',
    expect: 'always requires the count to delete a collection, however small',
    file: 'src/curation/collections.ts',
    find: `  if (confirmedCount !== target.videoIds.length) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'queue restoration uses the stored sort key',
    expect: 'rebuilds [A,B,C,D] after removing C, D, A and undoing in the SAME order',
    file: 'src/queue/restore.ts',
    find: `    return { ...queue, items: sorted([...queue.items, restored]) };`,
    replace: `    return { ...queue, items: [...queue.items, restored] };`,
  },
  {
    name: 'undone blockers stop blocking',
    expect: 'a removal that was itself undone no longer supersedes the addition',
    file: 'src/activity/supersession.ts',
    find: `|| l.undone) continue;`,
    replace: `) continue;`,
  },
];

/**
 * A baseline FIRST.
 *
 * Without it, a runner that cannot start counts every mutation as proved: the
 * catch below sees a non-zero exit and calls it red. That would report
 * "9 of 9 checks proved" having executed no assertion at all — the same shape
 * as a break-it that passes, which is the failure this whole pass exists to
 * catch (Gate C).
 */
function runTests() {
  try {
    return { failed: false, output: execSync('npm test', { stdio: 'pipe' }).toString() };
  } catch (e) {
    return { failed: true, output: `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}` };
  }
}

const baseline = runTests();
if (baseline.failed) {
  console.error('BASELINE RED — the suite already fails, so no mutation can prove anything. Fix that first.');
  console.error(baseline.output.split('\n').slice(-15).join('\n'));
  process.exit(1);
}
console.log('baseline: suite green\n');

let proved = 0;
const unproved = [];

for (const c of CHECKS) {
  const original = readFileSync(c.file, 'utf8');
  if (!original.includes(c.find)) {
    // Counted as UNPROVED, not skipped. A stale anchor silently loses coverage
    // as the source moves, and with every anchor stale this used to report
    // "0 of 0 proved" and exit zero (Gate C).
    unproved.push(`${c.name} — anchor not found in ${c.file}; the guard moved or was reformatted`);
    console.log(`STALE ${c.name}`);
    continue;
  }
  writeFileSync(c.file, original.replace(c.find, c.replace));
  const result = runTests();
  writeFileSync(c.file, original);

  if (!result.failed) {
    unproved.push(`${c.name} — removing the guard changed nothing; it is not covered`);
    console.log(`GREEN ${c.name}\n      *** removing this changed nothing ***`);
    continue;
  }
  // The suite went red — but did the RIGHT case go red?
  if (!result.output.includes(c.expect)) {
    unproved.push(`${c.name} — the suite failed, but not at "${c.expect}"`);
    console.log(`WRONG ${c.name}\n      *** failed somewhere else, so this guard is still unproved ***`);
    continue;
  }
  proved += 1;
  console.log(`RED   ${c.name}\n      via: ${c.expect}`);
}

console.log(`\n${proved} of ${CHECKS.length} checks proved.`);
for (const u of unproved) console.log(`  UNPROVED: ${u}`);
process.exit(unproved.length === 0 ? 0 : 1);
