/**
 * Tests for src/utils/cycleIndexOrphans.js (v4.23.3).
 * Reading a cycle must drop index entries whose Test Run was deleted or unlinked from the
 * cycle, keep the ones Jira's search has not indexed yet, and NEVER re-link anything.
 * All data below is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partitionOrphanEntries, indexRunsByRef, runRefOf } from '../src/utils/cycleIndexOrphans.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CYCLE = '9000';

const run = (id, key, prop) => ({ id, key, properties: prop ? { 'testpulse-run-data': prop } : {} });

test('runRefOf prefers the run id and falls back to the key', () => {
  assert.equal(runRefOf({ testRunId: '11', testRunKey: 'DEMO-1' }), '11');
  assert.equal(runRefOf({ testRunKey: 'DEMO-1' }), 'DEMO-1');
  assert.equal(runRefOf({ id: '5' }), '');
});

test('deleted and unlinked runs are dropped; indexing lag and legacy entries are kept', () => {
  const orphans = [
    { id: 'a', testRunId: '101' },                 // deleted in Jira
    { id: 'b', testRunId: '102' },                 // unlinked from this cycle
    { id: 'c', testRunId: '103' },                 // just created, search not caught up
    { id: 'd' },                                   // legacy entry without run
    { id: 'e', testRunId: '105' },                 // over the check limit (not sent)
    { id: 'f', testRunKey: 'DEMO-6' },             // matched by key
    { id: 'g', testRunId: '107' }                  // unlinked from ANOTHER cycle
  ];
  const runsByRef = indexRunsByRef([
    run('102', 'DEMO-2', { unlinkedFromCycle: true, cycleId: CYCLE }),
    run('103', 'DEMO-3', { status: 'Not Run' }),
    run('106', 'DEMO-6', { unlinkedFromCycle: true }),
    run('107', 'DEMO-7', { unlinkedFromCycle: true, cycleId: '8000' })
  ]);
  const checkedRefs = new Set(['101', '102', '103', 'DEMO-6', '107']);
  const { keep, drop } = partitionOrphanEntries(orphans, { checkedRefs, runsByRef }, CYCLE);
  assert.deepEqual(keep.map(e => e.id), ['c', 'd', 'e', 'g']);
  assert.deepEqual(drop.map(e => e.id), ['a', 'b', 'f']);
});

test('reading a cycle no longer re-links runs and checks orphans by bulk fetch', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(!src.includes('Auto-heal missing Jira issue link to cycle'), 'auto-heal re-link removed');
  assert.ok(src.includes('await verifyOrphanEntries(orphanEntries, cycleId)'));
  assert.ok(src.includes('route`/rest/api/3/issue/bulkfetch`'));
});

test('single-case removals are batched on the page', () => {
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes('queueCycleRemoval(cycleId, idsToTrack);'));
  assert.ok(!app.includes("invoke('removeTestFromCycle'"), 'no per-row request');
  assert.ok(app.includes('if (batch.ids.size > 0) flushCycleRemoval(cycleId);'), 'one request in flight per cycle');
});
