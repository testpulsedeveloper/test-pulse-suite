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
 * true when an error thrown by `api.asUser().requestJira` means Atlassian could not provide THIS
 * user's session ("Authentication Required"), not that Jira is down (v4.39.1).
 *
 * Why: on 2026-11-23 the calls made as three users failed with "Authentication Required". The
 * outage breaker counted those as Jira failures and paused Jira for EVERY user for 30 s, over and
 * over, so nobody could see their test cases. A session problem must only affect that user.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isUserAuthError(err) {
  const text = `${err?.name || ''} ${err?.code || ''} ${err?.message || ''}`;
  return /authentication required|needs?_?authentication|needsauthentication|unauthori[sz]ed|consent/i.test(text);
}

/** Shown when Atlassian could not confirm the user's session. */
const SESSION_MESSAGE = 'Atlassian no pudo confirmar tu sesión para Test Pulse. Recarga la página; si sigue igual, cierra sesión en Atlassian y vuelve a entrar.';

/**
 * Asks Jira whether the current user holds ALL of the given permissions, and tells apart
 * "Jira said no" from "Jira could not answer" (v4.34.2).
 *
 * Why: on 2026-11-19 Jira answered 503 / timed out for several minutes. The old check treated
 * any failed answer as "no permission", so members were told "No tienes acceso a este proyecto"
 * and that "no" stayed cached for 5 minutes after Jira came back.
 *
 * @param {Object} scope - `{ projectId }`, `{ issueId }` (ID or key) or `{ global: true }`.
 * @param {string[]} permissions - Jira permission keys, e.g. `['ADMINISTER_PROJECTS']`.
 * @returns {Promise<true|false|null>}
 *   true  = Jira confirmed every permission;
 *   false = Jira answered and at least one is missing (or the request is not valid);
 *   null  = unknown: Jira is rate-limiting (429), failing (5xx, also the synthetic 503 of the
 *           outage breaker) or the connection dropped. Never treated as a "yes".
 */
export async function checkPermissions({ projectId, issueId, global = false } = {}, permissions = []) {
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
    if (!res.ok) {
      // 429 and 5xx mean "Jira could not answer now", not "the user has no access".
      if (isJiraUnavailableStatus(res.status)) {
        console.warn(`[authz] permission check unavailable: HTTP ${res.status}`);
        return null;
      }
      return false;
    }
    const data = await res.json();
    return permissions.every(p => data?.permissions?.[p]?.havePermission === true);
  } catch (e) {
    if (isUserAuthError(e)) {
      // v4.39.1: the user's session, not Jira. Refused with its own code and message.
      console.warn('[authz] permission check: user session not available');
      throw new AuthorizationError('NEEDS_AUTH', SESSION_MESSAGE);
    }
    // Dropped connection / timeout: unknown as well.
    console.warn('[authz] permission check failed:', e?.message);
    return null;
  }
}

/** HTTP statuses that mean Jira is overloaded or failing, so a permission is unknown. */
function isJiraUnavailableStatus(status) {
  return status === 429 || (Number(status) >= 500 && Number(status) <= 599);
}

/**
 * Asks Jira whether the current user holds ALL of the given permissions.
 * Boolean version of `checkPermissions`: "unknown" counts as "no" (fail closed).
 *
 * @param {Object} scope - `{ projectId }`, `{ issueId }` (ID or key) or `{ global: true }`.
 * @param {string[]} permissions - Jira permission keys.
 * @returns {Promise<boolean>} `true` only when Jira confirms every permission.
 */
export async function userHasPermissions(scope = {}, permissions = []) {
  return (await checkPermissions(scope, permissions)) === true;
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
 * Superuser state of the current user: true / false, or null when Jira could not answer
 * (v4.34.2). Only definite answers are cached, so an outage is never remembered as a "no".
 *
 * @param {Object} context - Forge resolver context (`context.accountId`).
 * @returns {Promise<true|false|null>}
 */
async function superuserState(context) {
  const key = accountKey(context, 'superuser');
  const cached = cacheGet(_superuserCache, key, PERMISSION_CACHE_TTL_MS);
  if (cached !== undefined) return cached;

  const admin = await checkPermissions({ projectId: null, issueId: null, global: true }, ['ADMINISTER']);
  let result = admin === true ? true : null;
  let unknown = admin === null;
  if (result !== true) {
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/myself?expand=groups`);
      if (res.ok) {
        const me = await res.json();
        const groupName = getSuperuserGroupName().toLowerCase();
        result = (me?.groups?.items || []).some(g => String(g?.name || '').toLowerCase() === groupName);
      } else if (isJiraUnavailableStatus(res.status)) {
        unknown = true;
      } else {
        result = false;
      }
    } catch (e) {
      if (isUserAuthError(e)) throw new AuthorizationError('NEEDS_AUTH', SESSION_MESSAGE);
      console.warn('[authz] superuser group lookup failed:', e?.message);
      unknown = true;
    }
  }
  // A "yes" from either source is definite. A "no" is definite only when both sources answered.
  if (result === true) {
    cacheSet(_superuserCache, key, true);
    return true;
  }
  if (unknown) return null;
  cacheSet(_superuserCache, key, false);
  return false;
}

/**
 * Is the current user a Test Pulse superuser (Jira admin or member of the superuser group)?
 * "Unknown" (Jira not answering) counts as "no", but is not cached.
 *
 * @param {Object} context - Forge resolver context (`context.accountId`).
 * @returns {Promise<boolean>}
 */
export async function isSuperuser(context) {
  return (await superuserState(context)) === true;
}

/** Jira could not confirm the user's access (outage, timeouts, rate limit). */
const JIRA_UNAVAILABLE_MESSAGE = 'Jira no está respondiendo y no se pudo confirmar tu acceso al proyecto. Intenta de nuevo en un momento.';

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
  const browse = await checkPermissions({ projectId: ref }, ['BROWSE_PROJECTS']);
  const superuser = browse === true ? true : await superuserState(context);
  if (browse === true || superuser === true) {
    cacheSet(_browseCache, key, true);
    return true;
  }
  if (browse === null || superuser === null) {
    // v4.34.2: Jira did not answer. Access is still refused (fail closed), but with the real
    // reason, and the answer is NOT cached, so the user gets in as soon as Jira is back.
    throw new AuthorizationError('JIRA_UNAVAILABLE', JIRA_UNAVAILABLE_MESSAGE);
  }
  cacheSet(_browseCache, key, false);
  return false;
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
  const superuser = await superuserState(context);
  const admin = superuser === true ? true : await checkPermissions({ projectId: ref }, ['ADMINISTER_PROJECTS']);
  const result = superuser === true || admin === true;
  // v4.34.2: a "no" caused by Jira not answering is not remembered.
  if (result || (superuser === false && admin === false)) cacheSet(_projectAdminCache, key, result);
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

/**
 * Reads, as the current user, the Jira permissions a background job needs to act on their
 * behalf in `projectId`. Background jobs run as the app, so they only perform the actions
 * these flags allow (e.g. a user without "Delete issues" gets runs unlinked, never deleted).
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<{canDelete: boolean, canLink: boolean, canEdit: boolean}>}
 */
export async function getProjectActionPermissions(projectId) {
  const flags = { canDelete: false, canLink: false, canEdit: false };
  const ref = normalizeProjectRef(projectId);
  if (!ref) return flags;
  const perms = 'DELETE_ISSUES,LINK_ISSUES,EDIT_ISSUES';
  try {
    const res = await api.asUser().requestJira(
      route`/rest/api/3/mypermissions?projectId=${ref}&permissions=${perms}`
    );
    if (!res.ok) return flags;
    const data = await res.json();
    const has = (key) => data?.permissions?.[key]?.havePermission === true;
    return { canDelete: has('DELETE_ISSUES'), canLink: has('LINK_ISSUES'), canEdit: has('EDIT_ISSUES') };
  } catch (e) {
    console.warn('[authz] action permission lookup failed:', e?.message);
    return flags;
  }
}
