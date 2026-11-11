/**
 * @file cycleIndexOrphans.js
 * @description Decides what to do with "orphan" entries of a cycle index.
 *
 * Background
 * ----------
 * Every cycle keeps a small index of its cases in Jira issue properties. When the page reads a
 * cycle, `getCycleExecutionSummary` searches Jira for the Test Runs linked to the cycle and then
 * merges that live list with the stored index. An index entry whose Test Run did NOT come back
 * from the search is an "orphan". There are two very different reasons for that:
 *
 *   1. Jira's search index is a few seconds behind: the run was just created and linked, so
 *      it is real and must stay visible.
 *   2. The case was removed from the cycle (its run was deleted, or unlinked and flagged with
 *      `unlinkedFromCycle`), but the entry came back into the index because several removals
 *      wrote the index at the same time and one overwrote another.
 *
 * Until v4.23.2 every orphan was treated as case 1 and the read path even RE-LINKED its run to
 * the cycle, one by one with retries. With many orphans that undid the user's removals, hit
 * Jira's rate limit (429) and pushed the resolver past Forge's 25-second limit.
 *
 * Now the caller fetches the orphan runs directly by id (no search index involved) and this
 * module decides, with plain data, which entries to keep. Reading a cycle never writes links.
 */

/**
 * Normalises a value to a trimmed string ('' for null/undefined).
 *
 * @param {*} value - Any value.
 * @returns {string}
 */
const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Returns the reference (id first, then key) that identifies an entry's Test Run.
 *
 * @param {Object} entry - Cycle index entry.
 * @returns {string} Run id or key, or '' when the entry has no run.
 */
export function runRefOf(entry) {
  return str(entry?.testRunId) || str(entry?.testRunKey);
}

/**
 * Splits orphan index entries into the ones to keep and the ones to drop.
 *
 * Rules (in order):
 *   - Entry without a Test Run reference: keep (legacy entries; nothing to check).
 *   - Run reference that was not checked (over the per-read limit): keep, as before.
 *   - Run that Jira says does not exist (deleted): drop.
 *   - Run flagged `unlinkedFromCycle` for THIS cycle (or with no cycle recorded): drop.
 *   - Any other existing run: keep (most likely Jira's search index is still catching up).
 *
 * @param {Object[]} orphans - Index entries whose run was not in the live search.
 * @param {Object} lookup
 * @param {Set<string>} lookup.checkedRefs - Run ids/keys that were sent to Jira.
 * @param {Map<string, Object>} lookup.runsByRef - Found runs, keyed by BOTH id and key.
 * @param {string} cycleId - Id of the cycle being read.
 * @returns {{keep: Object[], drop: Object[]}}
 */
export function partitionOrphanEntries(orphans, { checkedRefs, runsByRef }, cycleId) {
  const keep = [];
  const drop = [];
  for (const entry of orphans || []) {
    const ref = runRefOf(entry);
    if (!ref || !checkedRefs.has(ref)) {
      keep.push(entry);
      continue;
    }
    const run = runsByRef.get(ref);
    if (!run) {
      // Jira did not return the run: it was deleted (or the user cannot see it any more).
      drop.push(entry);
      continue;
    }
    const prop = run.properties?.['testpulse-run-data'] || {};
    const flaggedCycle = str(prop.cycleId);
    if (prop.unlinkedFromCycle === true && (!flaggedCycle || flaggedCycle === str(cycleId))) {
      drop.push(entry);
      continue;
    }
    keep.push(entry);
  }
  return { keep, drop };
}

/**
 * Indexes the issues returned by Jira's bulk fetch by id AND key, so an index entry can be
 * matched whichever of the two it stored.
 *
 * @param {Object[]} issues - Issues from `POST /rest/api/3/issue/bulkfetch`.
 * @returns {Map<string, Object>}
 */
export function indexRunsByRef(issues) {
  const map = new Map();
  for (const issue of issues || []) {
    if (issue?.id) map.set(str(issue.id), issue);
    if (issue?.key) map.set(str(issue.key), issue);
  }
  return map;
}
