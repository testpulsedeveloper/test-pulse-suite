/**
 * @file cycleHealth.test.js
 * @description Tests for "Salud del ciclo" in Planeación (Test Pulse 5.0, v4.42.0).
 * Run with: node --test tests/cycleHealth.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCycleHealth, workingDaysBetween, addWorkingDays } from '../static/hello-world/src/utils/cycleHealthIndicators.js';

const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
// Made-up cycle: Mon 23 Nov – Fri 4 Dec 2026 (10 working days), today Fri 27 Nov (5 elapsed).
const schedule = { startDate: '2026-11-23', endDate: '2026-12-04', environment: 'QA' };
const now = new Date(2026, 10, 27, 12);
const tc = (status, linkedBugs) => ({ status, linkedBugs });

test('working days skip weekends and holidays', () => {
  assert.equal(workingDaysBetween(new Date(2026, 10, 23), new Date(2026, 11, 4)), 10);
  assert.equal(workingDaysBetween(new Date(2026, 10, 23), new Date(2026, 11, 4), new Set(['2026-11-25'])), 9);
  assert.equal(addWorkingDays(new Date(2026, 10, 27), 1).getDate(), 30); // Fri → Mon
});

test('progress, pace and projection', () => {
  // 20 cases, 6 executed after 5 of 10 working days: 30% vs 50% ideal, 1.2/day, needs 2.8/day.
  const tests = [...Array(4).fill(tc('Passed')), tc('Failed'), tc('Blocked'), ...Array(14).fill(tc('Not Run'))];
  const h = byId(computeCycleHealth({ tests, schedule, now }));
  assert.equal(h.ideal.value, '30% / 50%');
  assert.equal(h.ideal.tone, 'danger');
  assert.equal(h.pace.value, '1.2/día');
  assert.equal(h.pace.detail, 'Se necesitan 3/día');
  assert.equal(h.projection.tone, 'danger'); // 14 left at 1.2/day ends after 4 Dec
  assert.equal(h.passrate.value, '67%');
  assert.equal(h.blocked.value, '1');
});

test('bugs: blockers and pending retests; no bug data shows a dash', () => {
  const tests = [
    tc('Failed', [{ key: 'BUG-1', status: 'Ready for QA', priority: 'High' }]),
    tc('Failed', [{ key: 'BUG-2', status: 'Abierto', priority: 'Crítica' }]),
    tc('Passed', [{ key: 'BUG-3', status: 'Cerrado', priority: 'Highest' }])
  ];
  const h = byId(computeCycleHealth({ tests, schedule, now }));
  assert.equal(h.blockers.value, '1');
  assert.equal(h.retests.value, '1');
  assert.equal(byId(computeCycleHealth({ tests: [tc('Passed')], schedule, now })).blockers.value, '—');
});

test('environment downtime inside the cycle, open events count until now', () => {
  const environments = [{ id: 'env-qa', name: 'QA' }];
  const downtime = [
    { envId: 'env-qa', startedAt: new Date(2026, 10, 24, 10).toISOString(), endedAt: new Date(2026, 10, 24, 13).toISOString() },
    { envId: 'env-qa', startedAt: new Date(2026, 10, 27, 10).toISOString(), endedAt: null },
    { envId: 'env-uat', startedAt: new Date(2026, 10, 24, 10).toISOString(), endedAt: null }
  ];
  const h = byId(computeCycleHealth({ tests: [tc('Passed')], schedule, downtime, environments, now }));
  assert.equal(h.downtime.value, '5 h caído');
  assert.equal(byId(computeCycleHealth({ tests: [], schedule: {}, now })).ideal.value, '—');
});

test('a cycle without cases is neutral, not at risk', () => {
  const h = byId(computeCycleHealth({ tests: [], schedule, now }));
  assert.equal(h.ideal.tone, 'neutral');
  assert.equal(h.pace.tone, 'neutral');
});
