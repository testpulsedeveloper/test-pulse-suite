/**
 * @file authz.js
 * @description Central authorization helpers for Test Pulse Suite resolvers.
 *
 * Forge resolvers receive their `payload` from the browser, so every value inside it
 * (projectId, issue keys, config…) must be treated as untrusted input. Before the app
 * performs any privileged action (especially with `.asApp()`, which bypasses the user's
 * own Jira permissions), the resolver must confirm that the CURRENT user is allowed to
 * perform it. These helpers ask Jira directly via `.asUser()` and the
 * `/rest/api/3/mypermissions` endpoint, so the answer always reflects the real Jira
 * permission scheme of the person clicking in the UI.
 *
 * All helpers "fail closed": if Jira cannot be reached or answers with an error,
 * the permission is treated as NOT granted.
 */

import api, { route } from '@forge/api';

/**
 * Jira project IDs are numeric and project keys are uppercase alphanumerics
 * (e.g. `10001` or `QA`). Anything else is rejected before it reaches a JQL string or
 * a REST route, which prevents JQL injection through crafted payload values.
 *
 * @param {unknown} value - Raw project reference coming from the payload.
 * @returns {string|null} Trimmed project reference or `null` when it is not valid.
 */
export function normalizeProjectRef(value) {
  const str = String(value ?? '').trim();
  if (/^\d{1,18}$/.test(str)) return str;
  if (/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(str)) return str.toUpperCase();
  return null;
}

/**
 * Jira issue references are either numeric IDs (`10234`) or keys (`QA-123`).
 *
 * @param {unknown} value - Raw issue reference coming from the payload.
 * @returns {string|null} Trimmed issue reference or `null` when it is not valid.
 */
export function normalizeIssueRef(value) {
  const str = String(value ?? '').trim();
  if (/^\d{1,18}$/.test(str)) return str;
  if (/^[A-Za-z][A-Za-z0-9_]{0,49}-\d{1,12}$/.test(str)) return str.toUpperCase();
  return null;
}

/**
 * Asks Jira whether the current user holds ALL of the given permissions.
 * Exactly one of `projectId` / `issueId` should be supplied to scope the check.
 *
 * @param {Object} scope - `{ projectId }` or `{ issueId }` (ID or key).
 * @param {string[]} permissions - Jira permission keys, e.g. `['ADMINISTER_PROJECTS']`.
 * @returns {Promise<boolean>} `true` only when Jira confirms every permission.
 */
export async function userHasPermissions({ projectId, issueId } = {}, permissions = []) {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  const perms = permissions.join(',');
  try {
    let res;
    if (issueId) {
      res = await api.asUser().requestJira(
        route`/rest/api/3/mypermissions?issueId=${issueId}&permissions=${perms}`
      );
    } else if (projectId) {
      res = await api.asUser().requestJira(
        route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=${perms}`
      );
    } else {
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json();
    return permissions.every(p => data?.permissions?.[p]?.havePermission === true);
  } catch (e) {
    console.warn('[authz] permission check failed:', e?.message);
    return false;
  }
}

/**
 * Convenience wrapper: is the current user a Project Administrator of `projectId`?
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<boolean>}
 */
export async function isUserProjectAdmin(projectId) {
  const ref = normalizeProjectRef(projectId);
  if (!ref) return false;
  return userHasPermissions({ projectId: ref }, ['ADMINISTER_PROJECTS']);
}

/**
 * Convenience wrapper: can the current user browse `projectId`?
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<boolean>}
 */
export async function canUserBrowseProject(projectId) {
  const ref = normalizeProjectRef(projectId);
  if (!ref) return false;
  return userHasPermissions({ projectId: ref }, ['BROWSE_PROJECTS']);
}

/**
 * Loads an issue AS THE USER (so Jira enforces visibility / issue security levels) and
 * returns its canonical id, key and owning project. Returns `null` when the user cannot
 * see the issue or the reference is malformed.
 *
 * @param {string} issueRef - Issue ID or key.
 * @returns {Promise<{id: string, key: string, projectId: string, projectKey: string}|null>}
 */
export async function getIssueVisibleToUser(issueRef) {
  const ref = normalizeIssueRef(issueRef);
  if (!ref) return null;
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${ref}?fields=project`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.id || !data?.key) return null;
    return {
      id: String(data.id),
      key: String(data.key),
      projectId: String(data.fields?.project?.id || ''),
      projectKey: String(data.fields?.project?.key || '')
    };
  } catch (e) {
    console.warn('[authz] issue lookup failed:', e?.message);
    return null;
  }
}
