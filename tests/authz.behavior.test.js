/**
 * @file authz.behavior.test.js
 * @description Behavioural tests for the per-project permission model (v4.9.0).
 * `@forge/api` is replaced with a fake Jira that answers /mypermissions, /myself and the
 * `testpulse-enabled` project property, so the real authz.js logic runs end to end.
 * Run with: node --test --experimental-test-module-mocks tests/authz.behavior.test.js
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Fake Jira state, keyed by accountId. `currentUser` is who the next asUser() call acts as.
const jira = {
  currentUser: null,
  users: {
    'acc-member':  { projectPerms: { '100': ['BROWSE_PROJECTS'] }, global: [], groups: [] },
    'acc-padmin':  { projectPerms: { '100': ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] }, global: [], groups: [] },
    'acc-jiraadm': { projectPerms: {}, global: ['ADMINISTER'], groups: [] },
    'acc-group':   { projectPerms: {}, global: [], groups: ['test-pulse-admins'] },
    'acc-outsider':{ projectPerms: { '200': ['BROWSE_PROJECTS'] }, global: [], groups: [] }
  },
  enabled: { '100': true, '300': false },
  calls: 0,
  // v4.34.2: when set, every asUser() call answers with this HTTP status (simulated outage),
  // or throws when it is 'throw' (dropped connection).
  outage: null
};

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function handle(path, asApp, init = {}) {
  jira.calls++;
  if (jira.outage && !asApp) {
    if (jira.outage === 'throw') throw new Error('connect ETIMEDOUT');
    if (jira.outage === 'auth') {
      // Same shape as @forge/api's NeedsAuthenticationError.
      const err = new Error('Authentication Required');
      err.name = 'NEEDS_AUTHENTICATION_ERR';
      err.status = 401;
      throw err;
    }
    return json({ errorMessages: ['Service Unavailable'] }, jira.outage);
  }
  const url = new URL(path, 'https://jira.test');
  // v4.40.0: Jira's bulk permissions API, asked AS THE APP about a given accountId.
  if (asApp && url.pathname === '/rest/api/3/permissions/check') {
    const body = JSON.parse(init?.body || '{}');
    const user = jira.users[body.accountId] || { projectPerms: {}, global: [] };
    if (body.globalPermissions) return json({ globalPermissions: body.globalPermissions.filter(p => user.global.includes(p)) });
    const projectPermissions = (body.projectPermissions || []).flatMap(req => req.permissions.map(permission => ({
      permission,
      projects: (req.projects || []).filter(id => (user.projectPerms[String(id)] || []).includes(permission)),
      issues: []
    })));
    return json({ projectPermissions });
  }
  if (asApp && url.pathname === '/rest/api/3/user/groups') {
    const user = jira.users[url.searchParams.get('accountId')] || { groups: [] };
    return json(user.groups.map(name => ({ name })));
  }
  if (url.pathname === '/rest/api/3/mypermissions') {
    const user = jira.users[jira.currentUser];
    const keys = (url.searchParams.get('permissions') || '').split(',');
    const projectId = url.searchParams.get('projectId');
    const granted = projectId ? (user.projectPerms[projectId] || []) : user.global;
    const permissions = Object.fromEntries(keys.map(k => [k, { havePermission: granted.includes(k) }]));
    return json({ permissions });
  }
  if (url.pathname === '/rest/api/3/myself') {
    const user = jira.users[jira.currentUser];
    return json({ accountId: jira.currentUser, groups: { items: user.groups.map(name => ({ name })) } });
  }
  const m = url.pathname.match(/^\/rest\/api\/3\/project\/(\w+)\/properties\/testpulse-enabled$/);
  if (m && asApp) {
    if (!(m[1] in jira.enabled)) return json({}, 404);
    return json({ value: { enabled: jira.enabled[m[1]] } });
  }
  return json({}, 404);
}

// `route` tagged template: join and encode interpolated values like the real one.
const route = (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])).replace(/%2C/g, ',') : ''), '');

mock.module('@forge/api', {
  defaultExport: {
    asUser: () => ({ requestJira: async (p, init) => handle(p, false, init) }),
    asApp: () => ({ requestJira: async (p, init) => handle(p, true, init) })
  },
  namedExports: { route }
});

const authz = await import('../src/utils/authz.js');
const ctx = (accountId) => { jira.currentUser = accountId; return { accountId }; };

test('member can access but not administer their project', async () => {
  assert.equal(await authz.canAccessProject('100', ctx('acc-member')), true);
  assert.equal(await authz.canAdministerProject('100', ctx('acc-member')), false);
});

test('project admin administers only their own project', async () => {
  assert.equal(await authz.canAdministerProject('100', ctx('acc-padmin')), true);
  assert.equal(await authz.canAdministerProject('200', ctx('acc-padmin')), false);
});

test('Jira admin is a superuser in every project', async () => {
  assert.equal(await authz.isSuperuser(ctx('acc-jiraadm')), true);
  assert.equal(await authz.canAdministerProject('200', ctx('acc-jiraadm')), true);
  assert.equal(await authz.canAccessProject('300', ctx('acc-jiraadm')), true);
});

test('member of test-pulse-admins group is a superuser', async () => {
  assert.equal(await authz.isSuperuser(ctx('acc-group')), true);
  assert.equal(await authz.canAdministerProject('100', ctx('acc-group')), true);
});

test('user from another project cannot reach project 100', async () => {
  assert.equal(await authz.canAccessProject('100', ctx('acc-outsider')), false);
  assert.equal(await authz.isSuperuser(ctx('acc-outsider')), false);
});

test('answers are cached per account and never shared between users', async () => {
  // Admin answer for acc-padmin is cached; acc-member must still be denied.
  assert.equal(await authz.canAdministerProject('100', ctx('acc-padmin')), true);
  assert.equal(await authz.canAdministerProject('100', ctx('acc-member')), false);
  const before = jira.calls;
  await authz.canAdministerProject('100', ctx('acc-padmin'));
  assert.equal(jira.calls, before, 'second identical check is served from cache');
  // Without an accountId nothing is cached nor reused.
  jira.currentUser = 'acc-member';
  assert.equal(await authz.canAdministerProject('100', {}), false);
});

test('enabled flag: default on, explicit off, cache invalidation', async () => {
  assert.equal(await authz.isProjectEnabled('100'), true);
  assert.equal(await authz.isProjectEnabled('400'), true, 'no property = enabled');
  assert.equal(await authz.isProjectEnabled('300'), false);
  jira.enabled['300'] = true;
  assert.equal(await authz.isProjectEnabled('300'), false, 'still cached');
  authz.invalidateProjectEnabledCache('300');
  assert.equal(await authz.isProjectEnabled('300'), true);
});

test('requireProjectAdmin throws a FORBIDDEN AuthorizationError for members', async () => {
  await assert.rejects(authz.requireProjectAdmin('100', ctx('acc-member')), (e) => e.code === 'FORBIDDEN');
  await authz.requireProjectAdmin('100', ctx('acc-padmin'));
});

test('malformed project references are rejected before reaching Jira', async () => {
  assert.equal(await authz.canAccessProject('100" OR 1=1', ctx('acc-jiraadm')), false);
});

// ── v4.34.2: Jira not answering must not be reported (nor cached) as "no access" ─────────────

test('a member gets JIRA_UNAVAILABLE (not FORBIDDEN) while Jira answers 503, and gets in after', async () => {
  // A fresh account, so nothing about it is cached yet.
  jira.users['acc-outage'] = { projectPerms: { '100': ['BROWSE_PROJECTS'] }, global: [], groups: [] };
  jira.outage = 503;
  await assert.rejects(authz.canAccessProject('100', ctx('acc-outage')), (e) => e.code === 'JIRA_UNAVAILABLE');
  jira.outage = 'throw';
  await assert.rejects(authz.canAccessProject('100', ctx('acc-outage')), (e) => e.code === 'JIRA_UNAVAILABLE');
  // Jira is back: the earlier failures were not cached, so access works right away.
  jira.outage = null;
  assert.equal(await authz.canAccessProject('100', ctx('acc-outage')), true);
});

test('rate limiting (429) is also unknown, never a yes', async () => {
  jira.users['acc-limited'] = { projectPerms: {}, global: [], groups: [] };
  jira.outage = 429;
  await assert.rejects(authz.canAccessProject('100', ctx('acc-limited')), (e) => e.code === 'JIRA_UNAVAILABLE');
  jira.outage = null;
  // Once Jira answers, a real outsider is still refused with a plain false (FORBIDDEN upstream).
  assert.equal(await authz.canAccessProject('100', ctx('acc-limited')), false);
});

test('an admin check during an outage says no but is not remembered', async () => {
  jira.users['acc-padmin2'] = { projectPerms: { '100': ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] }, global: [], groups: [] };
  jira.outage = 503;
  assert.equal(await authz.canAdministerProject('100', ctx('acc-padmin2')), false);
  assert.equal(await authz.isSuperuser(ctx('acc-padmin2')), false);
  jira.outage = null;
  assert.equal(await authz.canAdministerProject('100', ctx('acc-padmin2')), true);
});

test('checkPermissions tells yes, no and unknown apart', async () => {
  ctx('acc-member');
  assert.equal(await authz.checkPermissions({ projectId: '100' }, ['BROWSE_PROJECTS']), true);
  assert.equal(await authz.checkPermissions({ projectId: '100' }, ['ADMINISTER_PROJECTS']), false);
  jira.outage = 504;
  assert.equal(await authz.checkPermissions({ projectId: '100' }, ['BROWSE_PROJECTS']), null);
  assert.equal(await authz.userHasPermissions({ projectId: '100' }, ['BROWSE_PROJECTS']), false);
  jira.outage = null;
});

// ── v4.39.1: a user's missing session is not a Jira outage ─────────────────────────────────────

test('"Authentication Required" reaches Forge untouched so it can ask the user for consent', async () => {
  jira.users['acc-nosession'] = { projectPerms: { '100': ['BROWSE_PROJECTS'] }, global: [], groups: [] };
  jira.outage = 'auth';
  // v4.39.2: the very same NEEDS_AUTHENTICATION_ERR, not wrapped in an AuthorizationError.
  await assert.rejects(authz.canAccessProject('100', ctx('acc-nosession')),
    (e) => e.name === 'NEEDS_AUTHENTICATION_ERR' && !(e instanceof authz.AuthorizationError));
  // Nothing was cached: once the session works, the user gets in.
  jira.outage = null;
  assert.equal(await authz.canAccessProject('100', ctx('acc-nosession')), true);
});

test('isUserAuthError tells session errors from network errors', () => {
  assert.equal(authz.isUserAuthError(new Error('Authentication Required')), true);
  assert.equal(authz.isUserAuthError({ name: 'NeedsAuthenticationError', message: '' }), true);
  assert.equal(authz.isUserAuthError(new Error('connect ETIMEDOUT')), false);
  assert.equal(authz.isUserAuthError(new Error('socket hang up')), false);
});

test('the outage breaker ignores session errors (source check)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes("if (!isUserAuthError(networkErr)) recordJiraOutageFailure("));
});

// ── v4.40.0: read-only contingency mode (TESTPULSE_ASAPP_FALLBACK=on) ─────────────────────────

const { isReadOnlyJiraRequest, isAppFallbackEnabled } = await import('../src/utils/appFallback.js');

test('contingency off: the consent error still reaches Forge', async () => {
  delete process.env.TESTPULSE_ASAPP_FALLBACK;
  jira.users['acc-cont-off'] = { projectPerms: { '100': ['BROWSE_PROJECTS'] }, global: [], groups: [] };
  jira.outage = 'auth';
  await assert.rejects(authz.canAccessProject('100', ctx('acc-cont-off')), (e) => e.name === 'NEEDS_AUTHENTICATION_ERR');
  jira.outage = null;
});

test('contingency on: the user\'s own permissions are checked as the app, and the invocation is marked', async () => {
  process.env.TESTPULSE_ASAPP_FALLBACK = 'on';
  const store = {};
  authz.setInvocationStoreProvider(() => store);
  jira.users['acc-cont-member'] = { projectPerms: { '100': ['BROWSE_PROJECTS'] }, global: [], groups: [] };
  jira.users['acc-cont-outsider'] = { projectPerms: { '200': ['BROWSE_PROJECTS'] }, global: [], groups: [] };
  jira.outage = 'auth';

  store.accountId = 'acc-cont-member';
  assert.equal(await authz.canAccessProject('100', ctx('acc-cont-member')), true);
  assert.equal(store.fallbackVerified, true, 'reads of this invocation may fall back');
  assert.equal(store.appFallback, 1);

  const outsiderStore = { accountId: 'acc-cont-outsider' };
  authz.setInvocationStoreProvider(() => outsiderStore);
  assert.equal(await authz.canAccessProject('100', ctx('acc-cont-outsider')), false, 'no access stays no access');
  assert.equal(outsiderStore.fallbackVerified, undefined);

  // A project admin check also works through the bulk API.
  jira.users['acc-cont-admin'] = { projectPerms: { '100': ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS'] }, global: [], groups: [] };
  authz.setInvocationStoreProvider(() => ({ accountId: 'acc-cont-admin' }));
  assert.equal(await authz.canAdministerProject('100', ctx('acc-cont-admin')), true);

  jira.outage = null;
  delete process.env.TESTPULSE_ASAPP_FALLBACK;
  authz.setInvocationStoreProvider(() => null);
});

test('only reads may be repeated as the app', () => {
  assert.equal(isReadOnlyJiraRequest(['/rest/api/3/issue/CUQ-1?fields=summary']), true);
  assert.equal(isReadOnlyJiraRequest([{ value: '/rest/api/3/search/jql' }, { method: 'POST' }]), true);
  assert.equal(isReadOnlyJiraRequest(['/rest/api/3/issue/bulkfetch', { method: 'POST' }]), true);
  assert.equal(isReadOnlyJiraRequest(['/rest/api/3/issue', { method: 'POST' }]), false, 'creating an issue');
  assert.equal(isReadOnlyJiraRequest(['/rest/api/3/issue/CUQ-1', { method: 'PUT' }]), false);
  assert.equal(isReadOnlyJiraRequest(['/rest/api/3/issue/CUQ-1/properties/x', { method: 'DELETE' }]), false);
  delete process.env.TESTPULSE_ASAPP_FALLBACK;
  assert.equal(isAppFallbackEnabled(), false, 'off unless the variable says "on"');
  process.env.TESTPULSE_ASAPP_FALLBACK = 'ON';
  assert.equal(isAppFallbackEnabled(), true);
  delete process.env.TESTPULSE_ASAPP_FALLBACK;
});

test('the request wrapper repeats only verified reads as the app (source check)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes("store?.fallbackVerified && isReadOnlyJiraRequest(reqArgs)"));
  assert.ok(src.includes("setInvocationStoreProvider(() => __perfALS.getStore());"));
});
