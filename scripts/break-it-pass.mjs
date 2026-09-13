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

  // ── T141: the guards Phases 8–14 added ────────────────────────────────────
  {
    // Placement-time and hold-time checks agree unless a newer command reached
    // the lane first and is still applying — the case this test was written for,
    // after this mutation first came back GREEN against the whole suite.
    name: 'the fence is checked when the lane is held, not when the call arrives',
    expect: 'an older command placed while a newer one is still applying is refused once it holds the lane',
    file: 'src/app/issue-fence.ts',
    edits: [
      {
        find: `    return (async () => {\n      try {\n        await Promise.all(waitFor);`,
        replace: `    const newerAtEntry = this.#newestAbove(lanes, command.issueSeq);\n    return (async () => {\n      try {\n        await Promise.all(waitFor);`,
      },
      { find: `        const newer = this.#newestAbove(lanes, command.issueSeq);`, replace: `        const newer = newerAtEntry;` },
    ],
  },
  {
    name: 'the turn\'s commandId is written over whatever the model sent',
    expect: 'injects the turn',
    file: 'server/assistant/attributed-transport.ts',
    find: `{ ...args, [COMMAND_ID_FIELD]: commandId }`,
    replace: `{ [COMMAND_ID_FIELD]: commandId, ...args }`,
  },
  {
    name: 'the upgrade is refused until the ticket is redeemed',
    expect: 'before the handshake',
    file: 'server/gateway/upgrade.ts',
    find: `    if (!check.ok) {`,
    replace: `    if (false) {`,
  },
  {
    name: 'the allowance is checked before any model work, not after',
    expect: 'refuses before the stream opens',
    file: 'server/assistant/turns.ts',
    edits: [
      {
        find: `  const admission = deps.allowance.admit(sessionId);\n  if (!admission.ok) {`,
        replace: `  const admission = { ok: true as const, snapshot: deps.allowance.snapshot(sessionId) };\n  if (false) {`,
      },
      {
        find: `    send('done', { stopReason: result.stopReason ?? 'end_turn' });`,
        replace: `    const late = deps.allowance.admit(sessionId);\n    if (!late.ok) send('refused', { reason: 'assistant_allowance_spent', detail: late.detail });\n    send('done', { stopReason: result.stopReason ?? 'end_turn' });`,
      },
    ],
  },
  {
    name: 'a player tool awaits the player confirming the change',
    expect: 'refuses success when the player ignores a pause',
    file: 'src/player/tools/transport.ts',
    find: `    return verified(p, PLAYER_STATE.paused, 'pause', timeoutMs);`,
    replace: `    return ok(snapshot(p));`,
  },
  {
    name: 'a turn waits for a tab whose tools are still being listed',
    expect: 'waits for the listing rather than refusing',
    file: 'server/assistant/turns.ts',
    find: `  if (sessionId !== null && page === undefined && deps.gateway.isConnecting(sessionId, tabId)) {`,
    replace: `  if (false) {`,
  },
  {
    name: 'a failed call to an undeclared tool is view_not_open, naming the view',
    expect: 'a call to a tool the page no longer has comes back as a refusal',
    file: 'server/gateway/page-connection.ts',
    find: `    return declared !== null && !declared.some((t) => t.name === name) ? refuseUnavailableView(name) : otherwise;`,
    replace: `    return otherwise;`,
  },
  {
    name: 'an unfinished turn that applied something is partially applied',
    expect: 'after an action applied is partially applied',
    file: 'src/assistant/turn-client.ts',
    find: `  if (applied > 0) return { outcome: 'partially_applied', reason: stoppedBecause };`,
    replace: ``,
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
  // A mutation that moves a check touches more than one place (T141).
  const edits = c.edits ?? [{ find: c.find, replace: c.replace }];
  const stale = edits.find((e) => original.split(e.find).length !== 2);
  if (stale !== undefined) {
    // Counted as UNPROVED, not skipped. A stale anchor silently loses coverage
    // as the source moves, and with every anchor stale this used to report
    // "0 of 0 proved" and exit zero (Gate C). An anchor found twice is as bad:
    // the mutation would land somewhere nobody chose.
    unproved.push(`${c.name} — anchor not found exactly once in ${c.file}; the guard moved or was reformatted`);
    console.log(`STALE ${c.name}`);
    continue;
  }
  writeFileSync(c.file, edits.reduce((text, e) => text.replace(e.find, e.replace), original));
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
