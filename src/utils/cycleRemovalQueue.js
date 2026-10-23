/**
 * @file cycleRemovalQueue.js
 * @description Background removal of test cases from a cycle (Forge async events).
 *
 * Removing many cases used to run inside the browser session: batches were sent one by one
 * from the page, so a reload in the middle stopped the remaining batches and some cases
 * stayed in the cycle. Now the resolver queues ONE job on the `cycle-removal-queue`; Forge
 * runs it in the background (up to 300 s) whether the page is open or not.
 *
 * While a job is pending, its case ids are kept in KVS under
 * `cycle_removal_<cycleId>_<jobId>` so the cycle list can hide them immediately, even after a
 * reload, until the background job has unlinked or deleted their Test Runs.
 */

import { Queue } from '@forge/events';
import { kvs as storage, WhereConditions } from '@forge/kvs';

export const CYCLE_REMOVAL_QUEUE_KEY = 'cycle-removal-queue';

// A pending marker older than this is ignored (the job crashed or was dropped by Forge).
export const PENDING_REMOVAL_TTL_MS = 30 * 60 * 1000;

const pendingPrefix = (cycleId) => `cycle_removal_${String(cycleId)}_`;

const removalQueue = new Queue({ key: CYCLE_REMOVAL_QUEUE_KEY });

/**
 * Queues a background removal job.
 * No concurrency key is sent: Forge rejected it in production (400 Bad Request), and it is
 * not needed because the cycle index is updated by the resolver before queueing; jobs only
 * touch their own Test Runs and `exec_<id>` properties, so two jobs never overwrite each other.
 *
 * @param {Object} body - Job payload (`cycleId`, `ids`, `knownRunIds`, `everyEntryHasRun`, `perms`, …).
 * @returns {Promise<string>} Forge job id.
 */
export async function enqueueCycleRemoval(body) {
  const { jobId } = await removalQueue.push({ body });
  return jobId;
}

/**
 * Remembers the ids of a queued job so the cycle list hides them until the job finishes.
 *
 * @param {string} cycleId - Cycle issue id.
 * @param {string} markerId - Unique id of this removal request.
 * @param {string[]} ids - Every id/key variant of the removed cases.
 */
export async function markPendingRemoval(cycleId, markerId, ids) {
  await storage.set(`${pendingPrefix(cycleId)}${markerId}`, { ids, createdAt: Date.now() });
}

/**
 * Forgets a job's pending ids once the background work is done (or failed for good).
 *
 * @param {string} cycleId - Cycle issue id.
 * @param {string} markerId - Unique id of the removal request.
 */
export async function clearPendingRemoval(cycleId, markerId) {
  await storage.delete(`${pendingPrefix(cycleId)}${markerId}`).catch(() => {});
}

/**
 * Returns every id currently being removed from `cycleId` by a background job.
 *
 * @param {string} cycleId - Cycle issue id.
 * @returns {Promise<Set<string>>}
 */
export async function getPendingRemovalIds(cycleId) {
  const pending = new Set();
  if (!cycleId) return pending;
  try {
    const now = Date.now();
    let cursor;
    do {
      let query = storage.query().where('key', WhereConditions.beginsWith(pendingPrefix(cycleId))).limit(20);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      for (const item of page?.results || []) {
        const value = item?.value || {};
        if (now - Number(value.createdAt || 0) > PENDING_REMOVAL_TTL_MS) continue;
        for (const id of value.ids || []) pending.add(String(id));
      }
      cursor = page?.nextCursor;
    } while (cursor);
  } catch (e) {
    console.warn('[cycleRemoval] pending lookup failed:', e?.message);
  }
  return pending;
}

/**
 * Removes from a cycle summary the entries whose case is still being removed in background.
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
