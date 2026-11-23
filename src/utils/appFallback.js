/**
 * @file appFallback.js
 * @description Read-only contingency mode for when Atlassian does not hand out user sessions
 * (v4.40.0).
 *
 * Background
 * ----------
 * On 2026-11-23 every `api.asUser()` call started to fail with NEEDS_AUTHENTICATION_ERR and
 * Atlassian's consent page itself failed ("upstream connect error … reset reason: overflow"), so
 * nobody could see their test cases. Test Pulse cannot fix Atlassian's side, but it can keep
 * people READING while that lasts:
 *
 *   1. The per-project permission check (authz.js) asks Jira, AS THE APP, whether THIS user
 *      (their accountId) has the permission, with the bulk permissions API. The user's own
 *      Jira permissions are still what decides; only who asks changes.
 *   2. Only after that check passed in the current invocation, a READ request that failed with
 *      NEEDS_AUTHENTICATION_ERR is repeated as the app (GET, and the POST searches that only
 *      read). Writes are never repeated: creating, editing or executing stays blocked, so Jira
 *      never shows a change made by the app instead of by the person.
 *
 * It is OFF unless the Forge variable TESTPULSE_ASAPP_FALLBACK is "on":
 *   forge variables set --environment production TESTPULSE_ASAPP_FALLBACK on   (then deploy)
 * Known limit: the check is per project; an issue hidden by an issue security level could be
 * visible in this mode.
 */

/** true when the contingency mode is switched on for this environment. */
export function isAppFallbackEnabled() {
  return String(process.env.TESTPULSE_ASAPP_FALLBACK || '').trim().toLowerCase() === 'on';
}

// POST endpoints that only READ (searches and bulk reads); every other POST writes.
const READ_ONLY_POSTS = [
  /^\/rest\/api\/3\/search(\/jql)?(\?|$)/,
  /^\/rest\/api\/3\/search\/approximate-count(\?|$)/,
  /^\/rest\/api\/3\/issue\/bulkfetch(\?|$)/,
  /^\/rest\/api\/3\/permissions\/check(\?|$)/,
  /^\/rest\/api\/3\/expression\/eval(\?|$)/
];

/** URL path of a requestJira first argument (a Forge Route object or a plain string). */
export function requestPath(target) {
  if (typeof target === 'string') return target;
  if (target && typeof target.value === 'string') return target.value;
  return String(target || '');
}

/**
 * true when `requestJira(target, init)` only reads data (safe to repeat as the app).
 *
 * @param {Array} args - The arguments given to requestJira.
 * @returns {boolean}
 */
export function isReadOnlyJiraRequest(args) {
  const path = requestPath(args?.[0]);
  const method = String(args?.[1]?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST') return READ_ONLY_POSTS.some(rx => rx.test(path));
  return false;
}
