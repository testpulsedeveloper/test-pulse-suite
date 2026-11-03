/**
 * @file compactIssueFields.js
 * @description Shrinks the `fields` object of a Jira issue before it is sent to the browser.
 *
 * The test case repository returns every case with its raw Jira fields (`rawFields`). Jira adds a
 * lot of data the UI never reads: a `self` URL on every object, user avatars in four sizes, icon
 * URLs for statuses and issue types, descriptions of statuses and types, and full copies of every
 * linked issue. In CUQ, 100 cases weighed ~1.2 MB, so only one page fitted per call under Forge's
 * response limit and the repository needed ~10 calls to load.
 *
 * This keeps the SAME object shape (so `rawFields.priority.name`, `rawFields.issuelinks[0]
 * .outwardIssue.fields.summary`, `rawFields[customField].value`, … keep working) and only drops
 * data no screen uses. What the UI reads from test case `rawFields` (checked in App.js,
 * PlanningView.jsx, ReportsView.jsx and utils/traceabilityHelpers.js):
 *   status.name · priority.name/iconUrl · reporter|creator.displayName/name/emailAddress/
 *   avatarUrls['24x24'|'32x32'] · labels · created · parent.key/fields.summary/fields.issuetype.name
 *   · issuelinks[].type.name/inward/outward · issuelinks[].inwardIssue|outwardIssue.key/fields.summary/
 *   fields.issuetype.name/fields.status.name · custom field options .value/.name/.displayName/.label
 */

// Keys that carry no information the UI uses, wherever they appear.
const DROP_KEYS = new Set([
  'self', 'expand', 'timeZone', 'accountType', 'locale', 'hierarchyLevel',
  'avatarId', 'entityId', 'subtask', 'untranslatedName'
]);

// Objects whose `description` is Jira's catalog text (status, issue type), not user content.
const CATALOG_OBJECTS = new Set(['status', 'issuetype', 'statusCategory', 'priority', 'resolution']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function compactValue(value, key) {
  if (Array.isArray(value)) return value.map(item => compactValue(item, key));
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k)) continue;
    if (k === 'avatarUrls' && isPlainObject(v)) {
      // Only the small avatar is shown (24x24, falling back to 32x32).
      const small = v['24x24'] || v['32x32'];
      if (small) out.avatarUrls = { '24x24': small };
      continue;
    }
    // Priority icons are shown next to the priority name; other icons are not.
    if (k === 'iconUrl' && key !== 'priority') continue;
    if (k === 'description' && CATALOG_OBJECTS.has(key)) continue;
    out[k] = compactValue(v, k);
  }
  return out;
}

/**
 * Returns a smaller copy of a Jira issue `fields` object with the same shape.
 *
 * @param {Object} fields - `issue.fields` as returned by Jira.
 * @returns {Object}
 */
export function compactIssueFields(fields) {
  if (!isPlainObject(fields)) return fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = compactValue(v, k);
  }
  return out;
}
