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

// Lists of Jira keys an initiative keeps: epics (phase 03) and Test Plans (phase 04).
const KEY_FIELDS = ['epicKeys', 'planKeys'];

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
 *   - { type: 'addKeys', field, keys }                   → field = 'epicKeys' | 'planKeys'
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
