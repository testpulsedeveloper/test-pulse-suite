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

// ── v4.27.0: stories of each epic and stories without cases ──────────────────────────────────

test('phase 03 returns each epic story with its cases and flags stories without cases', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /storyList: \[\] \}\]\)\);/);
  // Each story is its own group, so its executions are counted too.
  assert.match(server, /for \(const target of \[group, storyEntry\]\.filter\(Boolean\)\)/);
  // Stories without cases are listed first.
  assert.match(server, /\(a\.cases > 0\) - \(b\.cases > 0\)/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /label="Historias sin casos"/);
  assert.match(view, /Solo historias sin casos/);
  assert.match(view, /renderEpicStories\(item\)/);
});

// ── v4.28.0: Traceability removed from Reports; timeline shows names and a colour per plan ────

test('the Traceability sub-view and its project-wide load are gone', () => {
  const reports = read('static/hello-world/src/views/ReportsView.jsx');
  assert.doesNotMatch(reports, /setDashboardSubView\('traceability'\)/);
  assert.doesNotMatch(reports, /traceabilityRows/);
  const app = read('static/hello-world/src/App.js');
  assert.doesNotMatch(app, /getTraceabilityHierarchy|loadTraceabilityHierarchy/);
  const server = read('src/index.js');
  assert.doesNotMatch(server, /resolver\.define\('getTraceabilityHierarchy'/);
});

test('the timeline shows names, one colour per plan, and aligned rows', () => {
  const timeline = read('static/hello-world/src/components/LifecycleTimeline.jsx');
  assert.match(timeline, /export const planColor/);
  assert.match(timeline, /boxSizing: 'border-box', padding: `5px 8px 5px \$\{row\.level \? 18 : 0\}px`/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /label: plan\.summary \|\| key/);
  assert.match(view, /label: cycle\.summary \|\| cycle\.key/);
});

test('a cycle whose start date passed without executions is late; running ones are on time (v4.28.2)', () => {
  const source = read('static/hello-world/src/components/LifecycleTimeline.jsx');
  const body = source.slice(source.indexOf('export const barState'), source.indexOf('const OUTLINES'));
  // eslint-disable-next-line no-new-func
  const barState = new Function(`${body.replace('export const barState', 'const barState')}; return barState;`)();
  const today = Date.UTC(2026, 10, 17);
  const startedAgo = Date.UTC(2026, 10, 10);
  const startsLater = Date.UTC(2026, 10, 25);
  const endLater = Date.UTC(2026, 11, 15);
  const none = { total: 5, passed: 0, failed: 0, blocked: 0 };
  assert.equal(barState(none, endLater, today, startedAgo), 'late');
  assert.equal(barState(none, endLater, today, startsLater), 'pending');
  assert.equal(barState({ total: 5, passed: 1, failed: 0, blocked: 0 }, endLater, today, startedAgo), 'progress');
  assert.match(source, /progress: '#1F845A'/);
  assert.match(source, /outlineOffset: '-2px'/);
});

// ── v4.29.0: out-of-cycle runs, undated rows, Lifecycle kept in memory ──────────────────────

test('runs removed from their cycle are not counted and states have clearer names', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /fetchIssuesByKeys\(\[\.\.\.runKeys\], \['status'\], \['testpulse-run-data'\]\)/);
  assert.match(server, /if \(outOfCycle\.has\(linked\.key\)\) continue;/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /label: 'Sin ciclo'/);
  assert.match(view, /label: 'En ciclo, sin ejecutar'/);
});

test('cycles without dates keep their row in the timeline', () => {
  const timeline = read('static/hello-world/src/components/LifecycleTimeline.jsx');
  assert.match(timeline, /\{dated\.map\(row => \{/);
  assert.match(timeline, /Sin fechas en Planeación\{total > 0/);
});

test('Lifecycle stays mounted after the first visit and reloads only on demand', () => {
  const app = read('static/hello-world/src/App.js');
  assert.match(app, /\{lifecycleVisited && \(/);
  assert.match(app, /display: activeTab === 'lifecycle' \? 'block' : 'none'/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /invalidateResolverCache\('getLifecycleProgress'\)/);
  assert.match(view, /\}, \[selectedProjectId, reloadToken\]\);/);
});

// ── v4.30.0: create / rename Test Plans and Test Cycles from Test Pulse ──────────────────────

test('plans and cycles are created with the name as summary AND description', () => {
  const server = read('src/index.js');
  assert.match(server, /description: adfParagraph\(String\(description \|\| ''\)\.trim\(\) \|\| summary\)/);
  assert.equal((server.match(/const summary = cleanIssueName\(rawSummary\);/g) || []).length, 2);
  // A failed creation is reported instead of returning Jira's error body as if it worked.
  assert.match(server, /throw await jiraCreateError\(response, 'plan'\)/);
  assert.match(server, /throw await jiraCreateError\(response, 'ciclo'\)/);
});

test('renaming checks project and issue type, and runs as the user', () => {
  const server = read('src/index.js');
  const body = server.slice(server.indexOf("resolver.define('renameTestIssue'"), server.indexOf("resolver.define('renameTestIssue'") + 4000);
  assert.match(body, /if \(!projectId\) throw new Error/);
  assert.match(body, /La incidencia no pertenece a este proyecto/);
  // Issue types come from the stored project configuration, not from the browser.
  assert.match(body, /properties\/testops-config/);
  assert.match(body, /Solo se pueden renombrar Test Plans y Test Cycles/);
  assert.match(body, /api\.asUser\(\)\.requestJira\(route`\/rest\/api\/3\/issue\/\$\{issueId\}`, \{\s*method: 'PUT'/);
  const cache = read('static/hello-world/src/utils/queryClient.js');
  assert.match(cache, /'renameTestIssue',/);
});

test('the "+ Nuevo" buttons open Test Pulse form; Jira form stays as fallback', () => {
  const app = read('static/hello-world/src/App.js');
  assert.match(app, /const handleCreateIssue = \(kind\) =>/);
  assert.match(app, /onUseJiraForm=\{openJiraCreateIssue\}/);
  const planning = read('static/hello-world/src/views/PlanningView.jsx');
  assert.match(planning, /openRenameDialog\('plan', currentPlan\)/);
  assert.match(planning, /openRenameDialog\('cycle', selectedCycle\)/);
  assert.doesNotMatch(planning, /onClick=\{handleCreateIssue\}/);
});

test('every module uses the full width (no centred max-width) (v4.30.1)', () => {
  const css = read('static/hello-world/src/index.css');
  const planning = css.slice(css.indexOf('.planning-canvas {'), css.indexOf('}', css.indexOf('.planning-canvas {')));
  assert.doesNotMatch(planning, /^\s*max-width\s*:/m);
  assert.doesNotMatch(read('static/hello-world/src/views/LifecycleView.jsx'), /maxWidth: '1200px', margin: '0 auto'/);
  assert.doesNotMatch(read('static/hello-world/src/views/SettingsView.jsx'), /className="main-content" style=\{\{ maxWidth/);
});

// ── v4.30.2: Lifecycle sees plans / cycles created or changed in other tabs ──────────────────

import { createShortCache } from '../src/utils/asyncHelpers.js';

test('a cached entry older than notBefore is reloaded once, then shared', async () => {
  let t = 1000;
  const cachedFor = createShortCache({ ttlMs: 60000, now: () => t });
  let loads = 0;
  const loader = async () => ++loads;
  assert.equal(await cachedFor('k', loader), 1);
  t = 2000;
  assert.equal(await cachedFor('k', loader), 1); // still within 60 s
  const since = 2000;
  assert.equal(await cachedFor('k', loader, { notBefore: since }), 2); // older than "since": reload
  assert.equal(await cachedFor('k', loader, { notBefore: since }), 2); // the new load is shared
});

test('Lifecycle refreshes itself when shown again after changes elsewhere', () => {
  const cache = read('static/hello-world/src/utils/queryClient.js');
  assert.match(cache, /export const subscribeToMutations/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /subscribeToMutations\(\(\) => \{ staleRef\.current = true; \}\)/);
  assert.match(view, /if \(isActive && staleRef\.current\)/);
  assert.match(view, /\.\.\.\(fresh \? \{ fresh: true \} : \{\}\)/);
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.match(server, /const freshSince = payload\.fresh \? Date\.now\(\) : 0;/);
  assert.match(server, /cachedFor\(`cycles:\$\{accountId\}:\$\{projectId\}`, listProjectCycles, \{ notBefore \}\)/);
  assert.match(read('static/hello-world/src/App.js'), /isActive: activeTab === 'lifecycle'/);
});

test('a story can be found by key for the "historias sin épica" picker (v4.30.3)', () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  const body = server.slice(server.indexOf("resolver.define('findLifecycleStory'"), server.indexOf("// Picker of phases 03 and 04 (v4.22.0)"));
  assert.match(body, /fetchIssuesByKeys\(\[key\], \['summary', 'status', 'issuetype', 'parent', 'project'\]\)/);
  assert.match(body, /es de otro proyecto/);
  assert.match(body, /aquí solo se agregan historias o requerimientos/);
  // Diagnostics without keys or titles.
  assert.match(server, /\[lifecycle\] candidates project=\$\{projectId\} epics=\$\{epics\.length\}/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /invoke\('findLifecycleStory'/);
  assert.match(view, /Buscar \$\{typedKey\} en Jira/);
});

// ── v4.31.0: documents never vanish silently; reports store totals only; collapsible view ───

import { lostDeliverables, restoreMissingDeliverables } from '../src/utils/lifecycleOps.js';

test('a write may drop a deliverable only through an explicit removal', () => {
  const stored = storedWith(report('d1', 'Uno'), report('d2', 'Dos'));
  const staleCopy = storedWith(report('d1', 'Uno'));
  assert.deepEqual(lostDeliverables(stored, staleCopy), [{ phase: 'design', id: 'd2' }]);
  assert.deepEqual(lostDeliverables(stored, staleCopy, { type: 'removeDeliverable', phaseId: 'design', deliverableId: 'd2' }), []);
  const { raw, restored } = restoreMissingDeliverables(stored, staleCopy);
  assert.equal(restored, 1);
  assert.deepEqual(raw.phases.design.deliverables.map(d => d.id), ['d1', 'd2']);
});

test('reports keep totals only, the guard runs on every write, and refresh covers every report', async () => {
  const server = read('src/resolvers/lifecycleResolvers.js');
  assert.doesNotMatch(server, /findings: parsed\.findings\.map/);
  assert.match(server, /findingsCount: parsed\.findings\.length/);
  assert.match(server, /const lost = lostDeliverables\(stored, initiative, payload\.op\);/);
  assert.match(server, /restoreMissingDeliverables\(stored, raw\)/);
  assert.match(server, /const remaining = targets\.slice\(10\)\.map\(t => t\.id\);/);
  // Old reports are slimmed down when written again.
  const { __test } = await import('../src/resolvers/lifecycleResolvers.js');
  const old = { ...report('d9', 'Viejo'), report: { totals: { total: 2 }, findings: [{ id: 'H1' }, { id: 'H2' }] } };
  const clean = __test.sanitizeDeliverable(old, old, 'acc');
  assert.equal(clean.report.findings, undefined);
  assert.equal(clean.report.findingsCount, 2);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /deliverableIds: res\.remaining/);
  assert.match(view, /Expandir todos/);
  assert.match(view, /en total<\/span>/);
});

test('the shared refresh button reloads Lifecycle (v4.31.1)', () => {
  const app = read('static/hello-world/src/App.js');
  assert.match(app, /if \(activeTab === 'lifecycle'\) \{[\s\S]{0,400}setLifecycleRefreshSignal\(n => n \+ 1\)/);
  assert.match(app, /refreshSignal: lifecycleRefreshSignal/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /if \(refreshSignal > 0\) reloadAll\(\);/);
});
