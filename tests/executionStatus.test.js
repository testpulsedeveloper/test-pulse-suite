/**
 * @file executionStatus.test.js
 * @description v4.16.2: the overall status a tester chooses (Passed / Failed / Blocked) is no
 * longer overwritten by "In Progress" / "Not Run" when the iteration is edited or Stop is pressed.
 * Reproduces the production sequence seen on CUQ-2762 and CEL-14525 (2026-11-09).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateOverallStatus,
  resolveStatusAfterIterationChange
} from '../static/hello-world/src/utils/executionStatus.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notRunIter = [{ id: 'i1', status: 'Not Run', actualResult: '' }];

test('calculateOverallStatus keeps the historical rules', () => {
  assert.equal(calculateOverallStatus([]), 'Not Run');
  assert.equal(calculateOverallStatus([], 'Passed'), 'Passed');
  assert.equal(calculateOverallStatus([{ status: 'Pass' }, { status: 'Passed' }]), 'Passed');
  assert.equal(calculateOverallStatus([{ status: 'Passed' }, { status: 'Fail' }]), 'Failed');
  assert.equal(calculateOverallStatus([{ status: 'Passed' }, { status: 'Blocked' }]), 'Blocked');
  assert.equal(calculateOverallStatus([{ status: 'Passed' }, { status: 'Not Run' }]), 'In Progress');
  assert.equal(calculateOverallStatus([{}, { status: 'TODO' }]), 'Not Run');
});

test('typing the actual result while running keeps a status chosen by hand (CUQ-2762 11:40:51)', () => {
  const next = [{ ...notRunIter[0], actualResult: 'tienda 2' }];
  const status = resolveStatusAfterIterationChange({
    previousIterations: notRunIter, nextIterations: next, currentStatus: 'Passed', isRunning: true
  });
  assert.equal(status, 'Passed');
});

test('pressing Stop keeps a status chosen by hand (CUQ-2762 11:41:49, CEL-14525 11:03:57)', () => {
  for (const chosen of ['Passed', 'Failed', 'Blocked']) {
    const status = resolveStatusAfterIterationChange({
      previousIterations: notRunIter, nextIterations: notRunIter,
      currentStatus: chosen, isRunning: false, isStopping: true
    });
    assert.equal(status, chosen);
  }
});

test('a result coming from the iterations still wins', () => {
  const status = resolveStatusAfterIterationChange({
    previousIterations: notRunIter,
    nextIterations: [{ ...notRunIter[0], status: 'Failed' }],
    currentStatus: 'Passed', isRunning: true
  });
  assert.equal(status, 'Failed');
});

test('previous behaviour is kept when nothing was chosen by hand', () => {
  // Running with nothing decided → In Progress.
  assert.equal(resolveStatusAfterIterationChange({
    previousIterations: notRunIter, nextIterations: notRunIter, currentStatus: 'Not Run', isRunning: true
  }), 'In Progress');
  // Stop with nothing executed → back to Not Run.
  assert.equal(resolveStatusAfterIterationChange({
    previousIterations: notRunIter, nextIterations: notRunIter,
    currentStatus: 'In Progress', isRunning: false, isStopping: true
  }), 'Not Run');
  // A Passed that came from the iterations follows them when an iteration is reopened during Stop.
  assert.equal(resolveStatusAfterIterationChange({
    previousIterations: [{ status: 'Passed' }], nextIterations: [{ status: 'Not Run' }],
    currentStatus: 'Passed', isRunning: false, isStopping: true
  }), 'Not Run');
});

test('App.js uses the shared rule and updates the per-cycle cache when a status is chosen', () => {
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.match(app, /from '\.\/utils\/executionStatus'/);
  assert.doesNotMatch(app, /const calculateOverallStatus = \(/);
  const handler = app.slice(app.indexOf('const handleUpdateTestStatus'), app.indexOf('const calculateIterationStatus'));
  assert.match(handler, /applyTestPatch\(testId/);
  const stop = app.slice(app.indexOf('const handleStopExecution'), app.indexOf('const handleTakeover'));
  assert.match(stop, /resolveStatusAfterIterationChange\(/);
});
