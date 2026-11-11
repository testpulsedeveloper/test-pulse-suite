/**
 * @file asyncHelpers.js
 * @description Small helpers that keep the Lifecycle resolvers fast (v4.22.1).
 *
 * Reading the progress of an initiative means many Jira requests (stories, test cases, plans,
 * cycles). Two simple techniques keep that quick without overloading Jira:
 *   1. mapLimit         → independent requests run a few at a time instead of one by one.
 *   2. createShortCache → an expensive list is remembered for 60 seconds, so the next request
 *                         served by the same Forge instance does not search again.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/asyncHelpers.test.js).
 */

/**
 * Runs `task` over `items` with at most `limit` running at the same time, keeping the order of
 * the results. Sending everything at once would make Jira answer HTTP 429 (too many requests);
 * sending one by one is slow. A small limit is the middle ground.
 *
 * @param {Array} items
 * @param {number} limit - Maximum tasks running at the same time (at least 1).
 * @param {(item: any, index: number) => Promise<any>} task
 * @returns {Promise<Array>} Results in the same order as `items`.
 */
export async function mapLimit(items, limit, task) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await task(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, worker));
  return results;
}

/**
 * Creates a short-lived memory for expensive loads.
 *
 * The same Forge instance usually serves several requests in a row (opening an initiative, then
 * the picker, then adding a plan), so remembering a list for a minute removes most repeated
 * searches. IMPORTANT: build the key with the user's account id whenever the data depends on
 * what that user may see in Jira, so one user never receives another user's list.
 *
 * @param {Object} [options]
 * @param {number} [options.ttlMs=60000]   - How long an entry is reused.
 * @param {number} [options.maxEntries=100] - The memory is emptied when it reaches this size.
 * @param {() => number} [options.now=Date.now] - Clock (replaceable in tests).
 * @returns {(key: string, loader: () => Promise<any>) => Promise<any>}
 */
export function createShortCache({ ttlMs = 60 * 1000, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map(); // key → { at: number, promise: Promise }
  return function cachedFor(key, loader) {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.promise;
    if (entries.size >= maxEntries) entries.clear();
    // The promise itself is stored, so two requests arriving together share one load.
    const promise = Promise.resolve().then(loader);
    entries.set(key, { at: now(), promise });
    // A failed load must not be remembered.
    promise.catch(() => { if (entries.get(key)?.promise === promise) entries.delete(key); });
    return promise;
  };
}
