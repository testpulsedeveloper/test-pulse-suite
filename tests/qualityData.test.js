/**
 * @file qualityData.test.js
 * @description Tests for the Calidad figures of Test Pulse 5.0 (v4.45.0). Made-up data only.
 * Run with: node --test tests/qualityData.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenExecutions, progressSeries, riskCoverage, impediments, automation, perCycle, defectMetrics, kpiValues, planGoNoGo, KPI_CATALOG } from '../static/hello-world/src/utils/qualityData.js';

const now = new Date(2026, 10, 27, 12); // Fri 27 Nov 2026
const ex = (status, extra = {}) => ({ status, ...extra });
const cycles = [
  { id: 1, summary: 'Ciclo A', execution: [ex('Passed', { executedAt: '2026-11-24T10:00:00' }), ex('Failed', { executedAt: '2026-11-25T10:00:00' }), ex('Not Run'), ex('Blocked')] },
  { id: 2, summary: 'Ciclo B', execution: [ex('Passed', { iterations: [{ status: 'Passed' }, { status: 'Failed' }, { status: 'Passed' }] }), ex('Not Run')] }
];
const execs = flattenExecutions(cycles);

test('progress: ideal vs real in working days with projection', () => {
  const p = progressSeries(execs, { startDate: '2026-11-23', endDate: '2026-12-04' }, now);
  assert.equal(p.total, 6);
  assert.equal(p.executed, 4);
  assert.equal(p.idealPct, 50);
  assert.equal(p.donePct, 67);
  assert.equal(p.remaining, 5);
  assert.ok(p.points.length > 0);
  assert.equal(progressSeries(execs, {}, now).hasDates, false);
});

test('risk coverage, impediments, automation and per cycle', () => {
  const prio = (e) => (e.status === 'Passed' ? 'Highest' : 'Medium');
  const rc = riskCoverage(execs, prio);
  assert.equal(rc[0].label, 'Crítica');
  assert.equal(rc[0].pct, 100);
  const im = impediments(execs);
  assert.equal(im.blocked, 1);
  assert.equal(im.rerunPct, 25); // 1 of 4 executed ran more than once
  const au = automation(execs, (e) => Boolean(e.iterations));
  assert.equal(au.total, 1);
  assert.equal(au.flakyCount, 1); // Passed → Failed → Passed
  assert.equal(perCycle(cycles)[0].pct, 75);
});

test('defects: open, reopen, rejected, density, retests and arrivals', () => {
  const bugs = [
    { key: 'B-1', severity: 'Crítico', isDone: false, status: 'En curso', created: '2026-11-20T10:00:00' },
    { key: 'B-2', severity: 'Alto', isDone: false, status: 'Ready for QA', created: '2026-11-22T10:00:00' },
    { key: 'B-3', severity: 'Medio', isDone: true, isReopened: true, created: '2026-11-18T10:00:00', resolutiondate: '2026-11-21T10:00:00', resolution: 'Done' },
    { key: 'B-4', severity: 'Bajo', isDone: true, created: '2026-11-19T10:00:00', resolutiondate: '2026-11-20T10:00:00', resolution: 'Duplicate' }
  ];
  const d = defectMetrics({ bugs, totalCases: 40, now });
  assert.equal(d.open, 2);
  assert.equal(d.critOpen, 1);
  assert.equal(d.highOpen, 1);
  assert.equal(d.reopenPct, 50);
  assert.equal(d.rejected, 1);
  assert.equal(d.density, 10);
  assert.equal(d.retests, 1);
  assert.equal(d.openRows[0].key, 'B-1');
  assert.ok(d.series.pts.length > 1);
});

test('KPI catalogue has the 17 KPIs and honest values', () => {
  assert.equal(KPI_CATALOG.length, 17);
  const g = planGoNoGo({ execs, bugs: [], priorityOf: () => 'Highest' });
  assert.equal(g.criteria[0].id, 'critical');
  const v = kpiValues({ fpy: 84, slaPct: null, blockedPct: 3.1, progress: { hasDates: false }, defects: { density: 11.9, reopenPct: 6 }, autoPct: 22, goNoGo: g, reqCoveragePct: null });
  assert.equal(v['CE-4'].s, 'warn');
  assert.equal(v['CU-3'].s, 'none');
  assert.equal(v['SC-3'].value, '6 %');
  assert.equal(v['CU-2'].s, 'ok');
});
