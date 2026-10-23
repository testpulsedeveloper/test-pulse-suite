/**
 * @file runDataContract.js
 * @description Contract v2 of the `testpulse-run-data` issue property (Opción A, fase 0).
 *
 * Every Test Run issue stores its execution data in the `testpulse-run-data` entity
 * property. Version 2 keeps every v1 field untouched and adds a few fields that Jira
 * indexes for JQL through the `jira:entityProperty` module in manifest.yml:
 *
 *   schemaVersion   → 2 (absent = v1)
 *   activeCycleId   → the cycle the run currently belongs to; `null` when the run was
 *                     removed from the cycle but kept for history (`unlinkedFromCycle`).
 *                     Indexed as `tpCycleId`, so JQL never returns runs that left the cycle.
 *   projectId       → owning project, indexed as `tpProjectId`
 *   executedAtIso   → ISO copy of `executedAt` (which stays epoch ms for the frontend),
 *                     indexed as `tpExecutedAt` because Jira only indexes ISO dates
 *   updatedAt       → ISO timestamp of the last write; used later to detect a stale SQL index
 *
 * Writing through `stampRunDataV2` is idempotent: stamping an already-v2 object again only
 * refreshes `updatedAt` (and fills `projectId` if it was missing).
 */

export const RUN_DATA_SCHEMA_VERSION = 2;

/**
 * Converts an epoch-ms number, a numeric string or an ISO string into an ISO date string.
 *
 * @param {unknown} value - Raw `executedAt` value.
 * @returns {string|null} ISO string or `null` when the value is empty or not a date.
 */
export function toIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : NaN);
  const ms = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Returns a copy of `data` upgraded to contract v2, ready to be written to Jira.
 *
 * @param {Object} data - The `testpulse-run-data` object about to be written.
 * @param {string|number|null} [projectId] - Owning project, used when `data` has none.
 * @param {Date} [now] - Clock override for tests.
 * @returns {Object} v2 object (the input is not mutated).
 */
export function stampRunDataV2(data, projectId = null, now = new Date()) {
  const base = data && typeof data === 'object' ? data : {};
  const cycleId = base.cycleId !== undefined && base.cycleId !== null && base.cycleId !== ''
    ? String(base.cycleId)
    : null;
  const ownProject = base.projectId !== undefined && base.projectId !== null && base.projectId !== ''
    ? String(base.projectId)
    : null;

  return {
    ...base,
    schemaVersion: RUN_DATA_SCHEMA_VERSION,
    cycleId,
    activeCycleId: base.unlinkedFromCycle === true ? null : cycleId,
    projectId: ownProject || (projectId !== null && projectId !== undefined && projectId !== '' ? String(projectId) : null),
    executedAtIso: toIsoDate(base.executedAt),
    updatedAt: now.toISOString()
  };
}
