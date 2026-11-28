/**
 * @file cycleHealth.test.js
 * @description Tests for "Salud del ciclo" in Planeación (Test Pulse 5.0, v4.43.0).
 * Run with: node --test tests/cycleHealth.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCycleHealth, workingDaysBetween, addWorkingDays, cycleSemaforo } from '../static/hello-world/src/utils/cycleHealthIndicators.js';

const byId = (r) => Object.fromEntries(r.indicators.map(x => [x.id, x]));
// Made-up cycle: Mon 23 Nov – Fri 4 Dec 2026 (10 working days); today Fri 27 Nov (5 elapsed).
const schedule = { startDate: '2026-11-23', endDate: '2026-12-04', environment: 'QA' };
const now = new Date(2026, 10, 27, 12);
const tc = (status, extra = {}) => ({ status, ...extra });

test('working days skip weekends and holidays', () => {
  assert.equal(workingDaysBetween(new Date(2026, 10, 23), new Date(2026, 11, 4)), 10);
  assert.equal(workingDaysBetween(new Date(2026, 10, 23), new Date(2026, 11, 4), new Set(['2026-11-25'])), 9);
  assert.equal(addWorkingDays(new Date(2026, 10, 27), 1).getDate(), 30); // Fri → Mon
});

test('semáforo: holgura in working days with the failure thresholds', () => {
  assert.equal(cycleSemaforo({ total: 10, executed: 6, failed: 0, totalDays: 10, elapsedDays: 5 }).label, 'A TIEMPO · +1 d');
  assert.equal(cycleSemaforo({ total: 10, executed: 4, failed: 0, totalDays: 10, elapsedDays: 5 }).key, 'risk');
  assert.equal(cycleSemaforo({ total: 10, executed: 2, failed: 0, totalDays: 10, elapsedDays: 5 }).key, 'late');
  assert.equal(cycleSemaforo({ total: 10, executed: 6, failed: 3, totalDays: 10, elapsedDays: 5 }).key, 'late'); // 50 % failed
});

test('projection, blocked days and tester load', () => {
  const tests = [
    ...Array(4).fill(0).map(() => tc('Passed')), tc('Failed'), tc('Blocked'),
    ...Array(10).fill(0).map(() => tc('Not Run', { assignee: { displayName: 'Persona Uno' } })),
    ...Array(4).fill(0).map(() => tc('Not Run', { assignee: { displayName: 'Persona Dos' } }))
  ];
  const r = computeCycleHealth({ tests, schedule, now });
  const h = byId(r);
  assert.equal(r.figures.elapsedDays, 5);
  assert.equal(h.term.tone, 'danger'); // 14 left at 1.2/day ends long after 4 Dec
  assert.equal(h.blocked.value, '0.5 días'); // 1 blocked ÷ 2 planned per day
  assert.equal(h.load.value, 'Persona U. 10');
  assert.equal(h.load.detail, 'Pendientes: Persona U. 10 · Persona D. 4');
});

test('bugs: blockers, retests and Go / No-Go', () => {
  const tests = [
    tc('Failed', { linkedBugs: [{ key: 'BUG-1', status: 'Ready for QA', priority: 'High' }] }),
    tc('Failed', { linkedBugs: [{ key: 'BUG-2', status: 'Abierto', priority: 'Crítica' }] }),
    tc('Passed', { linkedBugs: [{ key: 'BUG-3', status: 'Cerrado', priority: 'Highest' }] })
  ];
  const h = byId(computeCycleHealth({ tests, schedule, planSchedule: { codeFreezeDate: '2026-12-05' }, now }));
  assert.equal(h.retests.value, '1 bug');
  assert.match(h.gonogo.detail, /congelamiento 5 dic/);
  assert.equal(h.gonogo.tone, 'danger');
});

test('downtime and unknown data are honest', () => {
  const environments = [{ id: 'env-qa', name: 'QA' }];
  const downtime = [
    { envId: 'env-qa', component: 'Autorizador', startedAt: new Date(2026, 10, 24, 10).toISOString(), endedAt: new Date(2026, 10, 24, 12, 15).toISOString() },
    { envId: 'env-qa', component: 'Autorizador', startedAt: new Date(2026, 10, 26, 10).toISOString(), endedAt: new Date(2026, 10, 26, 12).toISOString() }
  ];
  const h = byId(computeCycleHealth({ tests: [tc('Passed')], schedule, downtime, environments, now }));
  assert.equal(h.downtime.value, '4 h 15 min caído');
  assert.match(h.downtime.detail, /Autorizador \(2 veces\)/);
  assert.equal(h.scope.value, '—');
  assert.equal(h.defects.value, '—');
  const empty = byId(computeCycleHealth({ tests: [], schedule: {}, now }));
  assert.equal(empty.term.tone, 'neutral');
});

import { schedulePreview } from '../static/hello-world/src/utils/cycleHealthIndicators.js';

test('calendar preview: goal, real pace, projection and summary sentence', () => {
  const p = schedulePreview({ startDate: '2026-11-23', endDate: '2026-12-04', total: 100, executed: 60, scope: 'plan', freezeDate: '2026-12-05', goLiveDate: '2026-12-15', now });
  assert.equal(p.items[0].value, '10');
  assert.equal(p.items[1].value, '10 / día');
  assert.equal(p.items[2].value, '12 / día');
  assert.equal(p.light.key, 'ok');
  assert.match(p.text, /Hoy, día 5 de 10, el plan debería llevar 50 % y lleva 60 %/);
  assert.match(p.text, /antes del congelamiento de código \(5 dic\)/);
  assert.equal(schedulePreview({ startDate: '', endDate: '' }), null);
});
