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
  // Event schema v2 (@forge/events 3.x) only accepts a plain function consumer, not resolver+method.
  assert.ok(/queue: cycle-removal-queue\n(\s+#.*\n)?\s+function: cycleRemovalWorker/.test(m), 'consumer points to the worker function');
  assert.ok(!m.includes('method: process-cycle-removal'), 'no resolver-style consumer');
  assert.ok(src.includes('export const cycleRemovalWorker = async (event) => {') && src.includes('const job = event?.body || {};'), 'worker reads the job from event.body');
  assert.ok(/handler: index\.cycleRemovalWorker\n\s+timeoutSeconds: 300/.test(m));
});

test('in-resolver fallback stops at a deadline and keeps the leftover runs to resume them', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('deadlineAt: Date.now() + 18000'), 'fallback sets an 18 s deadline');
  assert.ok(src.includes('remainingRunIds.push(String(r.id));'), 'leftover runs are remembered');
  assert.ok(src.includes('await saveRemainingRuns(cycle.id, markerId, ids, result.remainingRunIds);'));
  assert.ok(src.includes("resolver.define('resumeCycleRemoval'"), 'leftovers can be resumed');
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes("await invoke('resumeCycleRemoval', { cycleId })"), 'the page finishes leftovers right away');
  assert.ok(app.includes('}, [selectedCycle?.id]);') && app.includes("const result = await invoke('resumeCycleRemoval', { cycleId })"), 'and again when a cycle is opened');
});

test('markers with leftover runs stay hidden longer and are listed for resuming', async () => {
  await q.saveRemainingRuns('20000', 'r1', ['CUQ-9'], ['7001', '7002']);
  const markers = await q.listPendingRemovals('20000');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].markerId, 'r1');
  assert.deepEqual(markers[0].value.remainingRunIds, ['7001', '7002']);
  // A leftover marker older than the 30-minute TTL is still live (7-day resume window).
  store.set('cycle_removal_20000_old', { ids: ['CUQ-8'], remainingRunIds: ['7003'], createdAt: Date.now() - q.PENDING_REMOVAL_TTL_MS - 1000 });
  assert.ok((await q.getPendingRemovalIds('20000')).has('CUQ-8'));
  store.set('cycle_removal_20000_ancient', { ids: ['CUQ-7'], remainingRunIds: ['7004'], createdAt: Date.now() - q.PENDING_RESUME_TTL_MS - 1000 });
  assert.equal((await q.getPendingRemovalIds('20000')).has('CUQ-7'), false);
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

test('Jira outage: no retries on 5xx, breaker pauses calls, UI stops auto-refresh (v4.12.2)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('const JIRA_OUTAGE_STATUSES = new Set([502, 503, 504]);'));
  assert.ok(src.includes('if (res && JIRA_OUTAGE_STATUSES.has(res.status)) {'), '5xx is returned without retry');
  assert.ok(!src.includes('res.status === 429 || res.status === 503'), 'the old 503 retry loop is gone');
  assert.ok(src.includes('if (Date.now() < __jiraOutage.openUntil) {'), 'paused instance answers without calling Jira');
  assert.ok(src.includes("recordJiraOutageFailure(networkErr?.message || 'network error');"), 'dropped connections count too');
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes("timed out|timeout|jira no est"), 'timeouts and 5xx trip the UI breaker');
  assert.ok(app.includes('if (document.hidden || isCircuitBroken()) return;'), 'report auto-sync respects the breaker');
  assert.ok(!app.includes("err?.message?.includes('429') || err?.status === 429) tripCircuitBreaker()"));
});

test('performance v4.14.0: one-call project bootstrap and multi-page test case loading', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes("resolver.define('getProjectBootstrap'"));
  assert.ok(src.includes("'getProjectBootstrap',\n  'isProjectAllowed',"), 'bootstrap is reachable on disabled projects (shows the disabled screen)');
  assert.ok(src.includes('__resolverFns.set(name, fn)'), 'resolvers are reusable in-process');
  assert.ok(src.includes('const pagesPerCall = Math.min(5, Math.max(1, Number(payload?.pagesPerCall) || 1));'));
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes("boot = await invoke('getProjectBootstrap', { projectId: targetProjectId });"));
  assert.ok(app.includes(": await Promise.allSettled(["), 'individual calls remain as fallback');
  assert.ok(app.includes('let pagesPerCall = 5;'));
  const qc = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/utils/queryClient.js'), 'utf8');
  assert.ok(qc.includes('getProjectBootstrap: 120_000,'), 'bootstrap is cached like the calls it replaces');
});

test('hotfix v4.14.1: getTestCases respects Forge response size; UI falls back to 1 page', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('const RESPONSE_BUDGET_CHARS = 2_500_000;'));
  assert.ok(src.includes('if (sizeSoFar + nextSize > RESPONSE_BUDGET_CHARS) break;'));
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(app.includes("if (pagesPerCall > 1 && /too large|size/i.test(String(err?.message || err))) {"));
});

test('every removal logs the accountId of who asked for it (v4.23.4)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes("const requestedBy = context?.accountId || 'n/a';"), 'requester read from the invocation context');
  assert.ok(src.includes('[cycleRemoval] requested cycle=${cycle.id} cases=${ids.length} requestedBy=${requestedBy}'), 'request logged with requester');
  assert.ok(src.includes('job=${jobId} requestedBy=${requestedBy}'), 'queued job logged with requester');
  assert.ok(src.includes('[cycleRemoval] inline cycle=${cycle.id}') && src.includes('requestedBy=${requestedBy}`);'), 'inline fallback logged with requester');
  assert.ok(src.includes("remaining=${remainingRuns} requestedBy=${context?.accountId || 'n/a'}"), 'resume logged with requester');
});
