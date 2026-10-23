/**
 * @file cycleRemoval.test.js
 * @description Tests for removing cases from a cycle in a background job (v4.11.0).
 * `@forge/kvs` and `@forge/events` are replaced with in-memory fakes so the real
 * cycleRemovalQueue.js logic runs.
 * Run with: node --test --experimental-test-module-mocks tests/cycleRemoval.test.js
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// In-memory KVS with the `query().where('key', beginsWith).limit().cursor().getMany()` API.
const store = new Map();
const kvs = {
  set: async (k, v) => { store.set(k, v); },
  get: async (k) => store.get(k),
  delete: async (k) => { store.delete(k); },
  query: () => {
    let prefix = '';
    const q = {
      where: (_prop, cond) => { prefix = cond.prefix; return q; },
      limit: () => q,
      cursor: () => q,
      getMany: async () => ({ results: [...store].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })) })
    };
    return q;
  }
};
const pushed = [];
class FakeQueue {
  constructor({ key }) { this.key = key; }
  async push(event) { pushed.push({ queue: this.key, ...event }); return { jobId: `job-${pushed.length}` }; }
}

mock.module('@forge/kvs', { namedExports: { kvs, WhereConditions: { beginsWith: (prefix) => ({ prefix }) } } });
mock.module('@forge/events', { namedExports: { Queue: FakeQueue } });

const q = await import('../src/utils/cycleRemovalQueue.js');

test('jobs go to the removal queue without a concurrency key (rejected by Forge with 400)', async () => {
  const jobId = await q.enqueueCycleRemoval({ cycleId: '10500', ids: ['CUQ-1'] });
  assert.equal(jobId, 'job-1');
  assert.equal(pushed[0].queue, q.CYCLE_REMOVAL_QUEUE_KEY);
  assert.deepEqual(pushed[0].body, { cycleId: '10500', ids: ['CUQ-1'] });
  assert.equal(pushed[0].concurrency, undefined);
});

test('pending ids hide cases until the job clears them, per cycle', async () => {
  await q.markPendingRemoval('10500', 'm1', ['201', 'CUQ-1']);
  await q.markPendingRemoval('10500', 'm2', ['202']);
  await q.markPendingRemoval('99999', 'm3', ['301']);
  const pending = await q.getPendingRemovalIds('10500');
  assert.deepEqual([...pending].sort(), ['201', '202', 'CUQ-1']);

  const entries = [
    { id: '201', testCaseKey: 'CUQ-1' },
    { id: '203', testRunId: '202' },
    { id: '204', testCaseKey: 'CUQ-4' }
  ];
  assert.deepEqual(q.filterPendingRemovals(entries, pending), [{ id: '204', testCaseKey: 'CUQ-4' }]);

  await q.clearPendingRemoval('10500', 'm1');
  await q.clearPendingRemoval('10500', 'm2');
  assert.equal((await q.getPendingRemovalIds('10500')).size, 0);
});

test('stale pending markers (crashed jobs) are ignored', async () => {
  store.set('cycle_removal_10500_old', { ids: ['999'], createdAt: Date.now() - q.PENDING_REMOVAL_TTL_MS - 1000 });
  assert.equal((await q.getPendingRemovalIds('10500')).has('999'), false);
});

test('non-array summaries pass through untouched', () => {
  assert.deepEqual(q.filterPendingRemovals({ error: 'x' }, new Set(['1'])), { error: 'x' });
  assert.deepEqual(q.filterPendingRemovals([{ id: '1' }], new Set()), [{ id: '1' }]);
});

test('removal resolvers queue the work; the worker runs as the app with the user permissions', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes("resolver.define('removeManyTestsFromCycle', requestCycleRemoval);"));
  assert.ok(src.includes("resolver.define('removeTestFromCycle', requestCycleRemoval);"));
  assert.ok(src.includes('const perms = await getProjectActionPermissions(cycle.projectId);'), 'permissions read as the user before queueing');
  assert.ok(src.includes('actAsApp: true, budgetMs: 280000'), 'worker runs as app with a long retry budget');
  assert.ok(src.includes('} else if (!perms.canDelete) {'), 'no delete without the user DELETE_ISSUES permission');
  assert.ok(src.includes('if (everyEntryHasRun) {'), 'only the known Test Runs are fetched');
  assert.ok(src.includes('existing.has(`exec_${testId}`)'), 'only existing exec_ properties are deleted');
  assert.ok(src.includes('getPendingRemovalIds(cycleId)'), 'cycle list hides pending removals');
  const m = fs.readFileSync(path.join(ROOT_DIR, 'manifest.yml'), 'utf8');
  assert.ok(m.includes('queue: cycle-removal-queue') && m.includes('method: process-cycle-removal'));
  assert.ok(/handler: index\.cycleRemovalWorker\n\s+timeoutSeconds: 300/.test(m));
});

test('in-resolver fallback stops at a deadline instead of hitting the 25 s timeout', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('deadlineAt: Date.now() + 18000'), 'fallback sets an 18 s deadline');
  assert.ok(src.includes('return { success: false, partial: true, unprocessedRuns, removed: ids.length };'));
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes('if (res?.partial) {'), 'frontend warns about a partial removal');
});

test('cycle summary no longer references an undefined `config` (bugs on a cycle broke the list)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(!src.includes('fetchBugsBatch(Array.from(cycleBugKeys), config,'));
  assert.ok(src.includes('fetchBugsBatch(Array.from(cycleBugKeys), null, null, cycleProjPrefix || null)'));
});

test('adding cases: bounded concurrency, idempotent retries and smaller batches (v4.11.2)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('await mapWithConcurrency(testCasesToCreate, RUN_PROCESSING_CONCURRENCY,'), 'runs are processed a few at a time');
  assert.ok(!src.includes('runProcessingPromises'), 'no unbounded Promise.all over every run');
  assert.ok(src.includes('const existingRuns = await findExistingRunsInCycle(cycleId);'), 'retries skip cases that already have a run');
  assert.ok(src.includes('`tpCycleId = ${jqlQuote(cycleId)}`'), 'uses the phase 0 JQL index');
  const planning = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/views/PlanningView.jsx'), 'utf8');
  assert.ok(planning.includes('const CHUNK_SIZE = 10;'));
});
