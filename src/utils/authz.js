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
 * Supply `projectId` or `issueId` to scope the check, or `global: true` for global
 * permissions such as `ADMINISTER`.
 *
 * @param {Object} scope - `{ projectId }`, `{ issueId }` (ID or key) or `{ global: true }`.
 * @param {string[]} permissions - Jira permission keys, e.g. `['ADMINISTER_PROJECTS']`.
 * @returns {Promise<boolean>} `true` only when Jira confirms every permission.
 */
export async function userHasPermissions({ projectId, issueId, global = false } = {}, permissions = []) {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  const perms = permissions.join(',');
  try {
    let res;
    if (global) {
      // Global permissions (e.g. ADMINISTER = "Administer Jira") are not scoped to a project.
      res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=${perms}`);
    } else if (issueId) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-project permission model (v4.9.0)
//
//   Member of a project   → BROWSE_PROJECTS in that project.
//   Project admin         → ADMINISTER_PROJECTS in that project (only that project).
//   Test Pulse superuser  → Jira global "Administer Jira" (ADMINISTER) OR member of the
//                           Jira group named by the TESTPULSE_SUPERUSER_GROUP Forge variable
//                           (default `test-pulse-admins`). Superusers administer Test Pulse in
//                           EVERY project, even where they are not project admins.
//
// Answers are cached in memory per Jira account (never shared between users) so the
// extra checks cost at most one Jira call per user/project every few minutes.
// ─────────────────────────────────────────────────────────────────────────────

const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;
const ENABLED_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const _superuserCache = new Map();
const _browseCache = new Map();
const _projectAdminCache = new Map();
const _enabledCache = new Map();

/**
 * Default Jira group whose members are Test Pulse superusers. Can be overridden with
 * `forge variables set TESTPULSE_SUPERUSER_GROUP <group-name>`.
 */
export const DEFAULT_SUPERUSER_GROUP = 'test-pulse-admins';

function getSuperuserGroupName() {
  const configured = String(process.env.TESTPULSE_SUPERUSER_GROUP || '').trim();
  return configured || DEFAULT_SUPERUSER_GROUP;
}

function cacheGet(map, key, ttlMs) {
  if (!key) return undefined;
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return undefined;
}

function cacheSet(map, key, value) {
  if (!key) return;
  if (map.size >= MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { at: Date.now(), value });
}

/**
 * Builds a per-account cache key. Returns `null` (= do not cache) when Forge did not
 * provide an accountId, so an answer can never leak from one user to another.
 */
function accountKey(context, suffix = '') {
  const accountId = context?.accountId ? String(context.accountId) : null;
  return accountId ? `${accountId}::${suffix}` : null;
}

/**
 * Error thrown by the central authorization filter. `code` is a stable identifier
 * the frontend can match (`FORBIDDEN`, `PROJECT_DISABLED`, `INVALID_PROJECT`).
 */
export class AuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
  }
}

/**
 * Is the current user a Test Pulse superuser (Jira admin or member of the superuser group)?
 *
 * @param {Object} context - Forge resolver context (`context.accountId`).
 * @returns {Promise<boolean>}
 */
export async function isSuperuser(context) {
  const key = accountKey(context, 'superuser');
  const cached = cacheGet(_superuserCache, key, PERMISSION_CACHE_TTL_MS);
  if (cached !== undefined) return cached;

  let result = await userHasPermissions({ projectId: null, issueId: null, global: true }, ['ADMINISTER']);
  if (!result) {
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/myself?expand=groups`);
      if (res.ok) {
        const me = await res.json();
        const groupName = getSuperuserGroupName().toLowerCase();
        result = (me?.groups?.items || []).some(g => String(g?.name || '').toLowerCase() === groupName);
      }
    } catch (e) {
      console.warn('[authz] superuser group lookup failed:', e?.message);
    }
  }
  cacheSet(_superuserCache, key, result);
  return result;
}

/**
 * Can the current user use Test Pulse in `projectId`? (superuser or project member)
 *
 * @param {string} projectId - Jira project ID or key.
 * @param {Object} context - Forge resolver context.
 * @returns {Promise<boolean>}
 */
export async function canAccessProject(projectId, context) {
  const ref = normalizeProjectRef(projectId);
  if (!ref) return false;
  const key = accountKey(context, `browse::${ref}`);
  const cached = cacheGet(_browseCache, key, PERMISSION_CACHE_TTL_MS);
  if (cached !== undefined) return cached;
  const result = (await userHasPermissions({ projectId: ref }, ['BROWSE_PROJECTS'])) || (await isSuperuser(context));
  cacheSet(_browseCache, key, result);
  return result;
}

/**
 * Can the current user administer Test Pulse in `projectId`? (superuser or admin of THAT project)
 *
 * @param {string} projectId - Jira project ID or key.
 * @param {Object} context - Forge resolver context.
 * @returns {Promise<boolean>}
 */
export async function canAdministerProject(projectId, context) {
  const ref = normalizeProjectRef(projectId);
  if (!ref) return false;
  const key = accountKey(context, `admin::${ref}`);
  const cached = cacheGet(_projectAdminCache, key, PERMISSION_CACHE_TTL_MS);
  if (cached !== undefined) return cached;
  const result = (await isSuperuser(context)) || (await userHasPermissions({ projectId: ref }, ['ADMINISTER_PROJECTS']));
  cacheSet(_projectAdminCache, key, result);
  return result;
}

/**
 * Reads the `testpulse-enabled` project property. Projects are enabled unless an admin
 * explicitly switched Test Pulse off (`{ enabled: false }`).
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<boolean>}
 */
export async function isProjectEnabled(projectId) {
  const ref = normalizeProjectRef(projectId);
  if (!ref) return false;
  const cached = cacheGet(_enabledCache, ref, ENABLED_CACHE_TTL_MS);
  if (cached !== undefined) return cached;
  let enabled = true;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/project/${ref}/properties/testpulse-enabled`);
    if (res.ok) {
      const data = await res.json();
      const value = data?.value;
      enabled = !(value && typeof value === 'object' && value.enabled === false);
    }
  } catch (e) {
    console.warn('[authz] enabled flag lookup failed:', e?.message);
  }
  cacheSet(_enabledCache, ref, enabled);
  return enabled;
}

/**
 * Forgets the cached enabled flag after an admin toggles it, so this instance applies
 * the new value immediately (other instances pick it up within 60 seconds).
 *
 * @param {string} projectId - Jira project ID or key.
 */
export function invalidateProjectEnabledCache(projectId) {
  const ref = normalizeProjectRef(projectId);
  if (ref) _enabledCache.delete(ref);
}

/**
 * Throws `AuthorizationError('FORBIDDEN')` unless the user administers `projectId`.
 *
 * @param {string} projectId - Jira project ID or key.
 * @param {Object} context - Forge resolver context.
 */
export async function requireProjectAdmin(projectId, context) {
  if (!(await canAdministerProject(projectId, context))) {
    throw new AuthorizationError('FORBIDDEN', 'Solo los administradores de este proyecto o los superusuarios de Test Pulse pueden realizar esta acción.');
  }
}
