/**
 * @file planCycleRules.test.js
 * @description v4.16.3: a Test Cycle belongs to at most one Test Plan. A cycle that already
 * belongs to another plan cannot be added to a new one (plans must not share cycles).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentPlanRefOfCycle, isSamePlan } from '../src/utils/planCycleRules.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');

test('the current plan of a cycle is read from every place it can be stored', () => {
  assert.equal(currentPlanRefOfCycle({ properties: {} }), null);
  assert.equal(currentPlanRefOfCycle({ properties: { 'testops-plan-link': { planId: '10500' } } }), '10500');
  assert.equal(currentPlanRefOfCycle({ properties: { 'testops-plan-link': { value: { planId: 'CUQ-7' } } } }), 'CUQ-7');
  assert.equal(currentPlanRefOfCycle({ properties: { 'testpulse-v2': { planId: '10501' } } }), '10501');
  // Removed from its plan (planId null, schedule kept) → free.
  assert.equal(currentPlanRefOfCycle({ properties: { 'testops-plan-link': { planId: null, schedule: { startDate: '2026-11-01' } } } }), null);
  // Parent issue that is a plan.
  assert.equal(currentPlanRefOfCycle({ fields: { parent: { id: '900', key: 'CUQ-9', fields: { issuetype: { name: 'Test Plan' } } } } }), '900');
  // A parent that is not a plan (an epic) does not count.
  assert.equal(currentPlanRefOfCycle({ fields: { parent: { id: '901', fields: { issuetype: { name: 'Epic' } } } } }), null);
});

test('a plan reference matches by ID or by key', () => {
  const plan = { id: '10500', key: 'CUQ-7' };
  assert.equal(isSamePlan('10500', plan), true);
  assert.equal(isSamePlan('cuq-7', plan), true);
  assert.equal(isSamePlan('10501', plan), false);
  assert.equal(isSamePlan(null, plan), false);
});

test('linkCycleToPlan rejects a cycle that belongs to another existing plan', () => {
  const index = read('src/index.js');
  const resolver = index.slice(index.indexOf("resolver.define('linkCycleToPlan'"), index.indexOf("resolver.define('unlinkCycleFromPlan'"));
  assert.match(resolver, /currentPlanRefOfCycle\(cycle\)/);
  assert.match(resolver, /!isSamePlan\(currentPlanRef, plan\)/);
  assert.match(resolver, /Este ciclo ya pertenece al plan/);
  // A link to a deleted plan (404) does not block.
  assert.match(resolver, /otherRes\.status !== 404/);
  // The rejection happens before the property is written.
  assert.ok(resolver.indexOf('Este ciclo ya pertenece al plan') < resolver.indexOf("method: 'PUT'"));
});

test('the Planning view only offers cycles without a plan', () => {
  const planning = read('static/hello-world/src/views/PlanningView.jsx');
  assert.match(planning, /filteredTestCycles\.filter\(c => !cycleHasLivePlan\(c\)\)/);
  assert.doesNotMatch(planning, /availableUnlinkedCycles = selectedPlanId\s*\? filteredTestCycles\.filter\(c => !isCycleInPlan\(c, selectedPlanId\)\)/);
  const app = read('static/hello-world/src/App.js');
  assert.match(app, /El ciclo ya pertenece a otro plan/);
});
