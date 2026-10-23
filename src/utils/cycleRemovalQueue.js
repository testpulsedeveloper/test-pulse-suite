/**
 * @file cycleRemovalQueue.js
 * @description Removal of test cases from a cycle that survives page reloads.
 *
 * Removing many cases used to run inside the browser session, so a reload in the middle left
 * some cases in the cycle. The resolver now:
 *   1. takes the cases out of the cycle index right away,
 *   2. stores a "pending removal" marker in KVS (`cycle_removal_<cycleId>_<markerId>`) so the
 *      cycle list keeps hiding those cases, even after a reload,
 *   3. tries to queue a Forge async event that finishes the work in the background.
 *
 * If the queue is unavailable (production answered `400 Bad Request` to every push so far),
 * the work runs in the resolver with an 18 s budget. Test Runs left over are stored in the
 * marker (`remainingRunIds`), and `resumeCycleRemoval` finishes them: the page calls it in a
 * loop right after removing, and again whenever a cycle is opened, so a reload only pauses
 * the cleanup instead of losing it.
 */

import { __requestAtlassianAsApp } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs as storage, WhereConditions } from '@forge/kvs';

export const CYCLE_REMOVAL_QUEUE_KEY = 'cycle-removal-queue';

// A marker without leftovers is ignored after 30 min (its background job crashed or was dropped).
export const PENDING_REMOVAL_TTL_MS = 30 * 60 * 1000;
// A marker with leftover runs waits up to 7 days for someone to open the cycle and resume it.
export const PENDING_RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const pendingPrefix = (cycleId) => `cycle_removal_${String(cycleId)}_`;

/**
 * Same HTTP client `@forge/events` uses by default, but it logs the raw body of a failed push.
 * The library only surfaces "400 Bad Request", which is not enough to find the cause.
 */
async function loggingQueueClient(path, init) {
  const res = await __requestAtlassianAsApp(path, init);
  if (res.status < 400) return res;
  let text = '';
  try {
    text = await res.text();
  } catch (_) {}
  console.warn(`[cycleRemoval] queue push HTTP ${res.status}: ${text.slice(0, 500) || '(empty body)'}`);
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {}
  // The body was consumed above, so hand the library an equivalent response object.
  return {
    ok: false,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    json: async () => parsed,
    text: async () => text
  };
}

const removalQueue = new Queue({ key: CYCLE_REMOVAL_QUEUE_KEY }, loggingQueueClient);

/**
 * Queues a background removal job (no concurrency key: see v4.11.1).
 *
 * @param {Object} body - Job payload (`cycleId`, `ids`, `knownRunIds`, `everyEntryHasRun`, `perms`, …).
 * @returns {Promise<string>} Forge job id.
 */
export async function enqueueCycleRemoval(body) {
  const { jobId } = await removalQueue.push({ body });
  return jobId;
}

/**
 * Remembers the ids of a removal so the cycle list hides them until it is finished.
 *
 * @param {string} cycleId - Cycle issue id.
 * @param {string} markerId - Unique id of this removal request.
 * @param {string[]} ids - Every id/key variant of the removed cases.
 */
export async function markPendingRemoval(cycleId, markerId, ids) {
  await storage.set(`${pendingPrefix(cycleId)}${markerId}`, { ids, createdAt: Date.now() });
}

/**
 * Stores the Test Runs that still need cleaning for a removal, so it can be resumed later.
 *
 * @param {string} cycleId - Cycle issue id.
 * @param {string} markerId - Unique id of the removal request.
 * @param {string[]} ids - Every id/key variant of the removed cases.
 * @param {string[]} remainingRunIds - Test Run ids not processed yet.
 */
export async function saveRemainingRuns(cycleId, markerId, ids, remainingRunIds) {
  await storage.set(`${pendingPrefix(cycleId)}${markerId}`, {
    ids,
    remainingRunIds,
    createdAt: Date.now()
  });
}

/**
 * Forgets a removal once its work is done.
 *
 * @param {string} cycleId - Cycle issue id.
 * @param {string} markerId - Unique id of the removal request.
 */
export async function clearPendingRemoval(cycleId, markerId) {
  await storage.delete(`${pendingPrefix(cycleId)}${markerId}`).catch(() => {});
}

const isLive = (value, now) => {
  const ttl = Array.isArray(value?.remainingRunIds) && value.remainingRunIds.length > 0
    ? PENDING_RESUME_TTL_MS
    : PENDING_REMOVAL_TTL_MS;
  return now - Number(value?.createdAt || 0) <= ttl;
};

/**
 * Lists the live removal markers of a cycle.
 *
 * @param {string} cycleId - Cycle issue id.
 * @returns {Promise<Array<{markerId: string, value: Object}>>}
 */
export async function listPendingRemovals(cycleId) {
  const markers = [];
  if (!cycleId) return markers;
  const prefix = pendingPrefix(cycleId);
  try {
    const now = Date.now();
    let cursor;
    do {
      let query = storage.query().where('key', WhereConditions.beginsWith(prefix)).limit(20);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      for (const item of page?.results || []) {
        const value = item?.value || {};
        if (!isLive(value, now)) continue;
        markers.push({ markerId: String(item.key).slice(prefix.length), value });
      }
      cursor = page?.nextCursor;
    } while (cursor);
  } catch (e) {
    console.warn('[cycleRemoval] pending lookup failed:', e?.message);
  }
  return markers;
}

/**
 * Returns every id currently being removed from `cycleId`.
 *
 * @param {string} cycleId - Cycle issue id.
 * @returns {Promise<Set<string>>}
 */
export async function getPendingRemovalIds(cycleId) {
  const pending = new Set();
  for (const { value } of await listPendingRemovals(cycleId)) {
    for (const id of value.ids || []) pending.add(String(id));
  }
  return pending;
}

/**
 * Removes from a cycle summary the entries whose case is still being removed.
 *
 * @param {Array<Object>|*} entries - Result of `getCycleExecutionSummary`.
 * @param {Set<string>} pendingIds - Ids returned by `getPendingRemovalIds`.
 * @returns {Array<Object>|*} Filtered entries (non-arrays are returned unchanged).
 */
export function filterPendingRemovals(entries, pendingIds) {
  if (!Array.isArray(entries) || !pendingIds || pendingIds.size === 0) return entries;
  const fields = ['id', 'key', 'testCaseId', 'testCaseKey', 'testRunId', 'testRunKey'];
  return entries.filter(entry => !fields.some(f => entry && entry[f] && pendingIds.has(String(entry[f]))));
}
