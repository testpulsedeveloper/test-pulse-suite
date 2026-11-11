/**
 * @file lifecycleEditors.js
 * @description Rules for WHO may edit the "Lifecycle" module (v4.19.0).
 *
 * Everybody who can use Test Pulse in a project can SEE its lifecycle (phases, deliverables,
 * findings). Only two kinds of people can CHANGE it:
 *   1. Administrators of the project and Test Pulse superusers (always).
 *   2. The people a project administrator picked in Settings → "Editores de Lifecycle".
 *
 * That list is stored per project in Forge storage (key `lifecycleEditors_<projectId>`), so it
 * does not depend on a Jira group existing.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/lifecycle.test.js).
 */

// Upper bound of the list: a QA team, not a whole company.
export const MAX_LIFECYCLE_EDITORS = 50;

/** Storage key of the editors list of one project. */
export const lifecycleEditorsKey = (projectId) => `lifecycleEditors_${projectId}`;

// Atlassian account ids look like "5b10ac8d82e05b22cc7d4ef5" or "712020:uuid".
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * Cleans the list of editors sent by the browser before it is stored: only valid account ids,
 * no duplicates, bounded texts, and only https avatar URLs.
 *
 * @param {Array<{accountId: string, displayName?: string, avatarUrl?: string}>} rawEditors
 * @returns {Array<{accountId: string, displayName: string, avatarUrl: string}>}
 */
export function sanitizeLifecycleEditors(rawEditors) {
  const seen = new Set();
  const editors = [];
  for (const raw of Array.isArray(rawEditors) ? rawEditors : []) {
    const accountId = String(raw?.accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(accountId) || seen.has(accountId)) continue;
    seen.add(accountId);
    const avatarUrl = String(raw?.avatarUrl || '').trim().slice(0, 500);
    editors.push({
      accountId,
      displayName: String(raw?.displayName || '').trim().slice(0, 120) || accountId,
      avatarUrl: /^https:\/\/[^\s]+$/i.test(avatarUrl) ? avatarUrl : ''
    });
    if (editors.length >= MAX_LIFECYCLE_EDITORS) break;
  }
  return editors;
}

/**
 * Is `accountId` in the stored list of editors?
 *
 * @param {Array<{accountId: string}>} editors - List as stored.
 * @param {string} accountId - Account id of the current user.
 * @returns {boolean}
 */
export function isListedLifecycleEditor(editors, accountId) {
  if (!accountId) return false;
  return (Array.isArray(editors) ? editors : []).some(editor => editor?.accountId === accountId);
}
