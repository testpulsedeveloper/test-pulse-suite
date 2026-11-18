/**
 * @file lifecycleOps.js
 * @description Applies ONE change to a lifecycle initiative (v4.23.6).
 *
 * Why this exists
 * ---------------
 * Until v4.23.5 every change in the "Ciclo de vida" view (add a findings report, edit it, remove
 * it, add an epic…) sent the WHOLE initiative as the browser had it, and the server stored it as
 * it came. When two changes overlapped, the second one carried a copy of the initiative that did
 * not have the first one yet, so it erased it. Examples seen in production:
 *   - a report added while another save or a Confluence refresh was still running;
 *   - two people (or two tabs) working on the same initiative.
 * The result was "I added 4 reports and after refreshing only 2 were left".
 *
 * Now the browser sends only WHAT changed (an "operation"), and the server applies it to the
 * version that is stored at that moment. Changes made by others in the meantime are kept.
 *
 * This module is plain data in, plain data out (no Forge calls), so it is unit-tested directly.
 * The result still goes through `sanitizeInitiative` in lifecycleResolvers.js before it is stored.
 */

// Phases that hold deliverables. Kept in sync with LIFECYCLE_PHASES in lifecycleResolvers.js.
const PHASES = ['plan', 'design', 'build', 'execute', 'release'];

// Lists of Jira keys an initiative keeps: epics and stories without epic (phase 03, the
// stories since v4.24.0) and Test Plans (phase 04).
const KEY_FIELDS = ['epicKeys', 'storyKeys', 'planKeys'];

/**
 * Builds a deep-enough copy of the stored initiative so the original object is never mutated.
 *
 * @param {Object} stored - Initiative as read from storage.
 * @returns {Object}
 */
function cloneInitiative(stored) {
  const phases = {};
  for (const phase of PHASES) {
    phases[phase] = { deliverables: [...(stored?.phases?.[phase]?.deliverables || [])] };
  }
  return {
    ...stored,
    epicKeys: [...(stored?.epicKeys || [])],
    planKeys: [...(stored?.planKeys || [])],
    storyKeys: [...(stored?.storyKeys || [])],
    phases
  };
}

/**
 * Applies one operation to the stored initiative and returns the new (unsanitized) initiative.
 *
 * Supported operations:
 *   - { type: 'info', name, description }               → renames / re-describes the initiative
 *   - { type: 'upsertDeliverable', phaseId, deliverable } → adds (no id) or updates (with id)
 *   - { type: 'removeDeliverable', phaseId, deliverableId }
 *   - { type: 'addKeys', field, keys }                   → field = 'epicKeys' | 'storyKeys' | 'planKeys'
 *   - { type: 'removeKey', field, key }
 *
 * @param {Object} stored - Initiative currently stored (the latest version).
 * @param {Object} op - Operation sent by the browser.
 * @returns {Object} New initiative, ready for sanitizeInitiative(result, stored, accountId).
 * @throws {Error} When the operation is unknown or malformed.
 */
export function applyLifecycleOperation(stored, op) {
  const next = cloneInitiative(stored);
  const type = op?.type;

  if (type === 'info') {
    next.name = op.name;
    next.description = op.description;
    return next;
  }

  if (type === 'upsertDeliverable' || type === 'removeDeliverable') {
    if (!PHASES.includes(op.phaseId)) throw new Error('Fase inválida.');
    const list = next.phases[op.phaseId].deliverables;

    if (type === 'removeDeliverable') {
      // Removing something that is already gone is not an error: the result is the same.
      next.phases[op.phaseId].deliverables = list.filter(item => item?.id !== op.deliverableId);
      return next;
    }

    const deliverable = op.deliverable || {};
    const index = deliverable.id ? list.findIndex(item => item?.id === deliverable.id) : -1;
    if (deliverable.id && index === -1) {
      // Somebody removed it while this person was editing it.
      throw new Error('El entregable ya no existe (alguien más lo quitó). Recarga la vista.');
    }
    if (index >= 0) {
      // Update: the fields sent replace the stored ones; `report` is protected by sanitize.
      list[index] = { ...list[index], ...deliverable };
    } else {
      // New deliverable: without an id, sanitizeDeliverable generates one.
      const { id, ...rest } = deliverable;
      list.push(rest);
    }
    return next;
  }

  if (type === 'addKeys' || type === 'removeKey') {
    if (!KEY_FIELDS.includes(op.field)) throw new Error('Lista inválida.');
    const current = next[op.field];
    if (type === 'addKeys') {
      const keys = Array.isArray(op.keys) ? op.keys : [];
      next[op.field] = [...current, ...keys.filter(key => !current.includes(key))];
    } else {
      next[op.field] = current.filter(key => key !== op.key);
    }
    return next;
  }

  throw new Error('Operación no reconocida.');
}

/**
 * Size check before writing to Forge Key-Value Storage, whose values may not exceed 240 KiB.
 * Findings reports keep their list of findings inside the initiative, so a very large initiative
 * could reach that ceiling; this gives a clear message instead of a generic storage error.
 *
 * @param {Object} initiative - Initiative about to be stored.
 * @param {number} [maxBytes=230000] - Margin below the 240 KiB limit.
 * @returns {boolean} true when the initiative fits.
 */
export function fitsInStorage(initiative, maxBytes = 230000) {
  return Buffer.byteLength(JSON.stringify(initiative), 'utf8') <= maxBytes;
}

/**
 * Deliverables that exist in `stored` but not in `next`, other than the one an explicit
 * "removeDeliverable" operation removes (v4.31.0 safety check).
 *
 * Every write of an initiative goes through this check: a deliverable may disappear ONLY because
 * someone pressed "Quitar". Any other path that would drop one (an old browser tab sending a stale
 * copy, a bug) is refused instead of silently losing documents.
 *
 * @param {Object} stored - Initiative as stored before the write.
 * @param {Object} next - Initiative about to be written.
 * @param {Object} [op] - The operation being applied, if any.
 * @returns {Array<{phase: string, id: string}>} What would be lost ([] = safe to write).
 */
export function lostDeliverables(stored, next, op) {
  const lost = [];
  for (const phase of PHASES) {
    const kept = new Set((next?.phases?.[phase]?.deliverables || []).map(d => d?.id));
    for (const deliverable of stored?.phases?.[phase]?.deliverables || []) {
      if (!deliverable?.id || kept.has(deliverable.id)) continue;
      const removedOnPurpose = op?.type === 'removeDeliverable' && op.phaseId === phase && op.deliverableId === deliverable.id;
      if (!removedOnPurpose) lost.push({ phase, id: deliverable.id });
    }
  }
  return lost;
}

/**
 * For the old "save the whole initiative" call (kept only for browser tabs opened before
 * v4.23.6): puts back every stored deliverable the browser's copy does not have, so a stale copy
 * can add or edit but never erase (v4.31.0).
 *
 * @param {Object} stored - Initiative as stored.
 * @param {Object} raw - Initiative sent by the browser.
 * @returns {{raw: Object, restored: number}} The browser copy with the missing deliverables added.
 */
export function restoreMissingDeliverables(stored, raw) {
  const phases = { ...(raw?.phases || {}) };
  let restored = 0;
  for (const phase of PHASES) {
    const list = [...(phases[phase]?.deliverables || [])];
    const present = new Set(list.map(d => d?.id));
    for (const deliverable of stored?.phases?.[phase]?.deliverables || []) {
      if (deliverable?.id && !present.has(deliverable.id)) {
        list.push(deliverable);
        restored++;
      }
    }
    phases[phase] = { deliverables: list };
  }
  return { raw: { ...raw, phases }, restored };
}

/**
 * Turns a date written in a report ("21/08/2026", "21-08-2026" or "2026-08-21") into YYYY-MM-DD.
 * Anything else (text, impossible dates) gives ''.
 *
 * @param {string} value
 * @returns {string}
 */
export function reportDateToIso(value) {
  const raw = String(value || '').trim();
  let year; let month; let day;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [, year, month, day] = match;
  else {
    match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return '';
    [, day, month, year] = match;
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Rejects dates such as 31/02/2026 (Date would silently roll them over to March).
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : '';
}

/**
 * Calendar day (YYYY-MM-DD) of an ISO timestamp in Mexico City time, so a page edited at night
 * is not shown as the next day (Confluence gives the time in UTC).
 *
 * @param {string} timestamp - e.g. "2026-08-21T03:15:00.000Z"
 * @returns {string} '' when the timestamp is not valid.
 */
export function localDayOf(timestamp) {
  const date = new Date(String(timestamp || ''));
  if (Number.isNaN(date.getTime())) return '';
  try {
    // 'en-CA' formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Fills "Responsable" and "Fecha de entrega" of a findings report from what was read in
 * Confluence (v4.33.0), so nobody has to type them:
 *   - Responsable      = "Analista QA" written in the report header.
 *   - Fecha de entrega = the most recent of the page's last edit and the report's "Fecha del
 *                        análisis".
 * When the report does not have a value, the one already stored (typed by hand) is kept.
 *
 * @param {Object} deliverable - Deliverable of kind 'findings' (with or without `report`).
 * @returns {Object} The same deliverable with `owner` / `date` updated (a new object).
 */
export function applyReportAutoFields(deliverable) {
  if (!deliverable || deliverable.kind !== 'findings' || !deliverable.report) return deliverable;
  const report = deliverable.report;
  const analyst = String(report.general?.analyst || '').trim().slice(0, 120);
  const dates = [localDayOf(report.pageUpdatedAt), reportDateToIso(report.general?.analysisDate)].filter(Boolean).sort();
  const latest = dates[dates.length - 1] || '';
  return {
    ...deliverable,
    owner: analyst || deliverable.owner || '',
    date: latest || deliverable.date || ''
  };
}
