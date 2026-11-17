/**
 * @file lifecycleOps.test.js
 * @description v4.23.6: lifecycle changes are applied one at a time to the STORED initiative,
 * so overlapping saves no longer erase each other ("4 reports added, 2 left"). Also covers the
 * traceability count that showed every test case twice.
 *
 * All names, links and keys below are made up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLifecycleOperation, fitsInStorage } from '../src/utils/lifecycleOps.js';
import { buildCaseIdToKey, countDistinctCases } from '../static/hello-world/src/utils/traceabilityHelpers.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');

const report = (id, name) => ({ id, kind: 'findings', name, url: `https://example.atlassian.net/wiki/spaces/X/pages/${id}/R` });
const storedWith = (...deliverables) => ({
  id: 'init000001',
  name: 'Iniciativa demo',
  epicKeys: ['DEMO-1'],
  planKeys: [],
  phases: { plan: { deliverables: [] }, design: { deliverables: deliverables }, build: { deliverables: [] }, execute: { deliverables: [] }, release: { deliverables: [] } }
});

test('two reports added from stale copies are both kept', () => {
  // Both browsers saw an initiative with reports 1 and 2; each one adds a different report.
  let stored = storedWith(report('d1', 'Uno'), report('d2', 'Dos'));
  stored = applyLifecycleOperation(stored, { type: 'upsertDeliverable', phaseId: 'design', deliverable: report(undefined, 'Tres') });
  stored = applyLifecycleOperation(stored, { type: 'upsertDeliverable', phaseId: 'design', deliverable: report(undefined, 'Cuatro') });
  assert.deepEqual(stored.phases.design.deliverables.map(d => d.name), ['Uno', 'Dos', 'Tres', 'Cuatro']);
  // New deliverables carry no id here: sanitizeDeliverable generates it.
  assert.equal(stored.phases.design.deliverables[3].id, undefined);
});

test('editing and removing touch only the targeted deliverable', () => {
  const stored = storedWith(report('d1', 'Uno'), report('d2', 'Dos'), report('d3', 'Tres'));
  const edited = applyLifecycleOperation(stored, { type: 'upsertDeliverable', phaseId: 'design', deliverable: { id: 'd2', name: 'Dos bis' } });
  assert.deepEqual(edited.phases.design.deliverables.map(d => d.name), ['Uno', 'Dos bis', 'Tres']);
  // The stored object is never mutated.
  assert.equal(stored.phases.design.deliverables[1].name, 'Dos');

  const removed = applyLifecycleOperation(edited, { type: 'removeDeliverable', phaseId: 'design', deliverableId: 'd1' });
  assert.deepEqual(removed.phases.design.deliverables.map(d => d.id), ['d2', 'd3']);
  assert.throws(() => applyLifecycleOperation(removed, { type: 'upsertDeliverable', phaseId: 'design', deliverable: { id: 'd1', name: 'x' } }), /ya no existe/);
});

test('epics and plans are added and removed without touching deliverables', () => {
  const stored = storedWith(report('d1', 'Uno'));
  const added = applyLifecycleOperation(stored, { type: 'addKeys', field: 'epicKeys', keys: ['DEMO-1', 'DEMO-2'] });
  assert.deepEqual(added.epicKeys, ['DEMO-1', 'DEMO-2']);
  const removed = applyLifecycleOperation(added, { type: 'removeKey', field: 'epicKeys', key: 'DEMO-1' });
  assert.deepEqual(removed.epicKeys, ['DEMO-2']);
  assert.equal(removed.phases.design.deliverables.length, 1);
  assert.throws(() => applyLifecycleOperation(stored, { type: 'addKeys', field: 'phases', keys: [] }), /inválida/);
  assert.throws(() => applyLifecycleOperation(stored, { type: 'nope' }), /no reconocida/);
  assert.throws(() => applyLifecycleOperation(stored, { type: 'removeDeliverable', phaseId: 'other' }), /Fase/);
});

test('the storage size guard rejects initiatives near the 240 KiB limit', () => {
  assert.equal(fitsInStorage(storedWith(report('d1', 'Uno'))), true);
  assert.equal(fitsInStorage({ blob: 'x'.repeat(240 * 1024) }), false);
});

test('the view sends single operations and the server applies them to the stored version', () => {
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /invoke\('updateLifecycleInitiative'/);
  assert.match(view, /type: 'upsertDeliverable'/);
  assert.match(view, /type: 'removeDeliverable'/);
  // A Confluence refresh no longer replaces the whole initiative on screen.
  assert.match(view, /mergeReports\(res\.initiative\)/);
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /resolver\.define\('updateLifecycleInitiative'[\s\S]*?await requireLifecycleEditor\(projectId, context\)[\s\S]*?applyLifecycleOperation\(stored, payload\.op\)/);
});

test('traceability counts a test case once even when known by key and id', () => {
  const idToKey = buildCaseIdToKey(
    [{ id: '101', key: 'DEMO-11' }, { id: '102', key: 'DEMO-12' }],
    [{ linkedTestCases: [{ id: '103', key: 'DEMO-13' }, { id: '104', key: 'DEMO-14' }] }]
  );
  const refs = new Set(['DEMO-11', '101', 'DEMO-12', '102', 'DEMO-13', '103', 'DEMO-14', '104']);
  assert.equal(countDistinctCases(refs, idToKey), 4);
  // An id with no known key still counts as one case.
  assert.equal(countDistinctCases(['999'], idToKey), 1);
});

// ── v4.24.0: teams, authors and stories without epic ─────────────────────────────────────────

import { sanitizeLifecycleEditors, teamOfEditor, cleanLifecycleTeam } from '../src/utils/lifecycleEditors.js';

test('editors keep only the Dev, QA and UAT teams', () => {
  const editors = sanitizeLifecycleEditors([
    { accountId: 'acc-1', displayName: 'Ana Demo', team: 'QA' },
    { accountId: 'acc-2', displayName: 'Beto Demo', team: 'negocio' },
    { accountId: 'acc-3', displayName: 'Ceci Demo' }
  ]);
  assert.deepEqual(editors.map(e => e.team), ['qa', '', '']);
  assert.equal(teamOfEditor(editors, 'acc-1'), 'qa');
  assert.equal(teamOfEditor(editors, 'nobody'), '');
  assert.equal(cleanLifecycleTeam('UAT'), 'uat');
});

test('stories without epic are added and removed like epics', () => {
  const stored = storedWith(report('d1', 'Uno'));
  const added = applyLifecycleOperation(stored, { type: 'addKeys', field: 'storyKeys', keys: ['DEMO-5', 'DEMO-6'] });
  assert.deepEqual(added.storyKeys, ['DEMO-5', 'DEMO-6']);
  assert.deepEqual(applyLifecycleOperation(added, { type: 'removeKey', field: 'storyKeys', key: 'DEMO-5' }).storyKeys, ['DEMO-6']);
});

test('the server records team and author of new deliverables and keeps them on edits', async () => {
  const { __test } = await import('../src/resolvers/lifecycleResolvers.js');
  const stored = storedWith();
  const raw = applyLifecycleOperation(stored, { type: 'upsertDeliverable', phaseId: 'design', deliverable: { ...report(undefined, 'Nuevo'), team: 'dev', createdBy: 'forged-by-browser' } });
  const saved = __test.sanitizeInitiative({ ...raw, storyKeys: ['demo-7', 'bad key'] }, stored, 'acc-author');
  const created = saved.phases.design.deliverables[0];
  assert.equal(created.team, 'dev');
  // The author comes from the server context, never from the browser.
  assert.equal(created.createdBy, 'acc-author');
  assert.deepEqual(saved.storyKeys, ['DEMO-7']);

  // Another person edits it later: the author stays the original one.
  const edited = __test.sanitizeInitiative(
    applyLifecycleOperation(saved, { type: 'upsertDeliverable', phaseId: 'design', deliverable: { id: created.id, team: 'uat' } }),
    saved, 'acc-other');
  assert.equal(edited.phases.design.deliverables[0].createdBy, 'acc-author');
  assert.equal(edited.phases.design.deliverables[0].team, 'uat');
});

test('the picker offers stories without epic and phase 03 reads them', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /list\(storyTypes, ' AND parent is EMPTY'\)/);
  assert.match(server, /computeProgress\(epicKeys, storyKeys\)/);
  assert.match(server, /looseStories: \[\.\.\.looseMap\.values\(\)\]/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /openPicker\(initiative, phase, 'storyKeys'\)/);
  assert.match(view, /renderGroupedDeliverables\(initiative, phase\)/);
});

// ── v4.25.0: team lists apart from editors, reporter decides the team in phase 03 ────────────

import { sanitizeLifecycleTeamMembers, mergeLifecyclePeople, lifecycleTeamsKey } from '../src/utils/lifecycleEditors.js';

test('team members need a valid team and team lists win over the editors list', () => {
  const members = sanitizeLifecycleTeamMembers([
    { accountId: 'acc-1', displayName: 'Ana Demo', team: 'dev' },
    { accountId: 'acc-2', displayName: 'Beto Demo', team: '' },
    { accountId: 'acc-3', displayName: 'Ceci Demo', team: 'otro' }
  ]);
  assert.deepEqual(members.map(m => m.accountId), ['acc-1']);
  const people = mergeLifecyclePeople(members, [
    { accountId: 'acc-1', displayName: 'Ana Demo', team: 'qa' },
    { accountId: 'acc-4', displayName: 'Dani Demo', team: 'uat' }
  ]);
  assert.equal(people.find(p => p.accountId === 'acc-1').team, 'dev');
  assert.equal(people.find(p => p.accountId === 'acc-4').team, 'uat');
  // Must not collide with the prefix used to list initiatives.
  assert.equal(lifecycleTeamsKey('10001').startsWith('lifecycle_'), false);
});

test('teams are managed by admins and phase 03 groups by the Jira reporter', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /resolver\.define\('saveLifecycleTeams'[\s\S]*?await requireProjectAdmin\(projectId, context\)/);
  assert.match(server, /\['summary', 'reporter'\]/);
  assert.match(server, /loose\.reporter = reporterOf\(story\)/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /teamOf: \(item\) => teamOfPerson\(item\.reporter\?\.accountId\)/);
  assert.match(view, /toggleGroup\(key\)/);
  const settings = read('static/hello-world/src/views/SettingsView.jsx');
  assert.match(settings, /<LifecycleTeamsCard /);
});

// ── v4.26.0: timeline ────────────────────────────────────────────────────────────────────────

test('cycle dates travel with the cycle listing and the general timeline is a lazy resolver', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  // Same search as before, one more property (Jira allows up to 5 per search).
  assert.match(server, /\['testops-plan-link', 'testpulse-v2', 'execution-meta', 'testpulse-schedule'\]/);
  assert.match(server, /\.\.\.cycleDates\(issue\)/);
  assert.match(server, /resolver\.define\('getLifecycleTimeline'[\s\S]*?mapLimit\(allPlanKeys, 5,/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  // The general timeline is requested only from the button, never on load.
  assert.match(view, /const toggleGeneralTimeline = async/);
  assert.equal((view.match(/invoke\('getLifecycleTimeline'/g) || []).length, 1);
  assert.match(view, /renderInitiativeTimeline\(initiative, progress\)/);
});

test('timeline bar states: done, late, in progress, pending', async () => {
  // The component file is JSX; only its pure barState rule is evaluated here.
  const source = read('static/hello-world/src/components/LifecycleTimeline.jsx');
  const body = source.slice(source.indexOf('export const barState'), source.indexOf('const STATE_COLORS'));
  // eslint-disable-next-line no-new-func
  const barState = new Function(`${body.replace('export const barState', 'const barState')}; return barState;`)();
  const today = Date.UTC(2026, 10, 17);
  const past = Date.UTC(2026, 10, 1);
  const future = Date.UTC(2026, 11, 1);
  assert.equal(barState({ total: 4, passed: 4, failed: 0, blocked: 0 }, past, today), 'done');
  assert.equal(barState({ total: 4, passed: 1, failed: 0, blocked: 0 }, past, today), 'late');
  assert.equal(barState({ total: 4, passed: 1, failed: 1, blocked: 0 }, future, today), 'progress');
  assert.equal(barState({ total: 4, passed: 0, failed: 0, blocked: 0 }, future, today), 'pending');
});
