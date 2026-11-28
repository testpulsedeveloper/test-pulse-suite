/**
 * @file designFlagHome.test.js
 * @description Tests for the Test Pulse 5.0 design switch and the Inicio summary (v4.41.0).
 * Run with: node --test tests/designFlagHome.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNewDesign, isRollbackWindowOpen } from '../static/hello-world/src/utils/designFlag.js';
import { buildHomeSummary, cycleHealth, isCycleDone } from '../static/hello-world/src/utils/homeSummary.js';

const before = new Date(2026, 10, 28, 10); // Sat 28 Nov 2026
const after = new Date(2026, 11, 15, 10);  // Tue 15 Dec 2026 (rollback window closed)

test('project switch off: only people who opted in see 5.0', () => {
  assert.equal(resolveNewDesign({ newDesignEnabled: false }, null, before), false);
  assert.equal(resolveNewDesign({}, 'new', before), true);
  assert.equal(resolveNewDesign(null, 'old', before), false);
});

test('project switch on: everyone sees 5.0 unless they go back inside the window', () => {
  assert.equal(resolveNewDesign({ newDesignEnabled: true }, null, before), true);
  assert.equal(resolveNewDesign({ newDesignEnabled: true }, 'old', before), false);
  // After 14 Dec the personal "old" preference no longer applies.
  assert.equal(resolveNewDesign({ newDesignEnabled: true }, 'old', after), true);
});

test('rollback window includes 14 Dec and closes on 15 Dec', () => {
  assert.equal(isRollbackWindowOpen(new Date(2026, 11, 14, 23, 59)), true);
  assert.equal(isRollbackWindowOpen(after), false);
});

// Made-up cycles (no real data).
const cyc = (id, status, meta, startDate, endDate) => ({ id, key: `TP-${id}`, summary: `Ciclo ${id}`, status, executionMeta: meta, schedule: startDate ? { startDate, endDate } : null });
const now = new Date(2026, 10, 27, 12); // Fri 27 Nov 2026

test('cycle health: late, at risk, on time, no dates and complete', () => {
  assert.equal(cycleHealth(cyc(1, 'In Progress', { total: 10, passed: 5 }, '2026-11-01', '2026-11-20'), now).key, 'late');
  assert.equal(cycleHealth(cyc(2, 'In Progress', { total: 10, passed: 1 }, '2026-11-20', '2026-11-30'), now).key, 'risk');
  assert.equal(cycleHealth(cyc(3, 'In Progress', { total: 10, passed: 7 }, '2026-11-20', '2026-11-30'), now).key, 'ok');
  assert.equal(cycleHealth(cyc(4, 'In Progress', { total: 10, passed: 1 }), now).key, 'nodates');
  assert.equal(cycleHealth(cyc(5, 'In Progress', { total: 4, passed: 2, failed: 1, blocked: 1 }, '2026-11-01', '2026-11-02'), now).key, 'done');
});

test('summary ignores finished and empty cycles and orders by urgency', () => {
  const s = buildHomeSummary([
    cyc(1, 'In Progress', { total: 10, passed: 7 }, '2026-11-20', '2026-11-30'),
    cyc(2, 'Cerrado', { total: 50, passed: 50 }, '2026-10-01', '2026-10-10'),
    cyc(3, 'In Progress', { total: 0 }),
    cyc(4, 'In Progress', { total: 10, passed: 3, failed: 2, blocked: 1 }, '2026-11-01', '2026-11-20')
  ], now);
  assert.equal(isCycleDone({ status: 'Cerrado' }), true);
  assert.equal(s.activeCount, 2);
  assert.deepEqual(s.rows.map(r => r.id), ['4', '1']);
  assert.equal(s.totals.total, 20);
  assert.equal(s.totals.executed, 13);
  assert.equal(s.progressPct, 65);
  assert.equal(s.passRatePct, 77); // 10 passed of 13 executed
  assert.equal(s.lateCount, 1);
});

test('pass rate is null when nothing has run yet', () => {
  assert.equal(buildHomeSummary([cyc(1, 'To Do', { total: 5 })], now).passRatePct, null);
});
