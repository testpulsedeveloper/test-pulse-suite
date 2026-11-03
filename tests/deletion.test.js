/**
 * @file deletion.test.js
 * @description Permanent deletion of Test Cases (Design) and cycles (Planning), v4.15.0.
 * Only users with Jira's "Delete issues" permission; not executed runs are deleted,
 * executed runs are kept as history; the UI always confirms first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
const planning = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/views/PlanningView.jsx'), 'utf8');

test('backend: both deletions require Jira "Delete issues" and run as the user', () => {
  assert.ok(src.includes("resolver.define('deleteTestCases'"));
  assert.ok(src.includes("resolver.define('deleteTestCycle'"));
  assert.equal((src.match(/await requireDeletePermission\(projectId\);/g) || []).length, 2);
  assert.ok(src.includes('if (!perms.canDelete) {'));
  assert.ok(src.includes("api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?deleteSubtasks=true`, { method: 'DELETE' })"));
});

test('backend: only NOT executed runs are deleted; executed runs are kept and flagged', () => {
  assert.ok(src.includes('function isRunExecuted(run) {'));
  assert.ok(src.includes('testCaseDeleted: true'), 'runs of a deleted case keep their history');
  assert.ok(src.includes('cycleDeleted: true'), 'runs of a deleted cycle are unlinked and kept');
  assert.ok(src.includes('if (pending > 0) {'), 'the cycle is deleted only after all its runs were handled');
});

test('frontend: actions only with the permission, always behind a danger confirmation', () => {
  assert.ok(app.includes('{selectedDesignTestIds.size > 0 && canDeleteIssues && ('), 'Design delete button gated by permission');
  assert.ok(planning.includes('{canDeleteIssues && ('), 'cycle delete button gated by permission');
  assert.ok(app.includes("{ danger: true, confirmLabel: 'Eliminar de Jira' }"));
  assert.ok(app.includes("{ danger: true, confirmLabel: 'Eliminar ciclo' }"));
  assert.ok(app.includes('Esta acción no se puede deshacer.'));
  assert.ok(src.includes("call('getMyProjectPermissions')"), 'permission arrives with the project bootstrap');
});
