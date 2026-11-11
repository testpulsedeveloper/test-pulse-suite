/**
 * @file qaKpis.test.js
 * @description v4.17.0: blocked-cases rate (limit 10 %, fuse 30 %) and MTTR per severity against
 * the SLA of the KPI proposal (24 h / 48 h / 5 business days, in business hours).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockedRate,
  severityGroup,
  mttrBySeverity,
  formatBusinessDuration
} from '../static/hello-world/src/utils/qaKpis.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('blockedRate applies the 10 % limit and the 30 % fuse', () => {
  assert.equal(blockedRate(0, 0).level, 'empty');
  assert.equal(blockedRate(9, 100).level, 'ok');
  assert.equal(blockedRate(10, 100).level, 'warning');
  assert.equal(blockedRate(29, 100).level, 'warning');
  assert.equal(blockedRate(30, 100).level, 'fuse');
  assert.equal(blockedRate(3, 4).pct, 75);
});

test('severityGroup understands Spanish, English and Jira priority names', () => {
  assert.equal(severityGroup('Bloqueante'), 'critical');
  assert.equal(severityGroup('Crítico'), 'critical');
  assert.equal(severityGroup('Highest'), 'critical');
  assert.equal(severityGroup('Mayor'), 'high');
  assert.equal(severityGroup('Alta'), 'high');
  assert.equal(severityGroup('High'), 'high');
  assert.equal(severityGroup('Medio'), 'medium');
  assert.equal(severityGroup('Menor'), 'medium');
  assert.equal(severityGroup('Low'), 'medium');
  assert.equal(severityGroup(''), 'none');
  assert.equal(severityGroup(undefined), 'none');
});

test('mttrBySeverity averages closed bugs and measures SLA compliance', () => {
  const groups = mttrBySeverity([
    { severity: 'Bloqueante', isDone: true, hours: 10 },
    { severity: 'Crítico', isDone: true, hours: 30 },   // outside 24 h
    { severity: 'Mayor', isDone: true, hours: 40 },     // inside 48 h
    { severity: 'Menor', isDone: true, hours: 60 },     // outside 5 business days (50 h)
    { severity: 'Bloqueante', isDone: true, hours: 0 }, // no measurable time → ignored
    { severity: '', isDone: true, hours: 5 }
  ]);
  const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
  assert.equal(byKey.critical.closed, 2);
  assert.equal(byKey.critical.avgHours, 20);
  assert.equal(byKey.critical.withinSla, 1);
  assert.equal(byKey.critical.compliancePct, 50);
  assert.equal(byKey.critical.level, 'ok'); // mean of 20 h is within 24 h
  assert.equal(byKey.high.level, 'ok');
  assert.equal(byKey.medium.level, 'breach');
  assert.equal(byKey.none.level, 'neutral');
  assert.equal(byKey.none.compliancePct, null);
});

test('open bugs past their SLA mark the group as breached', () => {
  const groups = mttrBySeverity([
    { severity: 'Crítico', isDone: true, hours: 5 },
    { severity: 'Crítico', isDone: false, hours: 30 },
    { severity: 'Crítico', isDone: false, hours: 3 }
  ]);
  const critical = groups[0];
  assert.equal(critical.open, 2);
  assert.equal(critical.openOverdue, 1);
  assert.equal(critical.level, 'breach');
  assert.equal(mttrBySeverity([])[0].level, 'empty');
  assert.equal(mttrBySeverity(null).length, 4);
});

test('formatBusinessDuration switches to business days at 10 hours', () => {
  assert.equal(formatBusinessDuration(null), '—');
  assert.equal(formatBusinessDuration(4.25), '4.3 h');
  assert.equal(formatBusinessDuration(25), '2.5 días háb.');
});

test('Reports renders the KPI widget and the fuse banner from the shared rules', () => {
  const view = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/views/ReportsView.jsx'), 'utf8');
  const constants = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/utils/constants.js'), 'utf8');
  assert.match(view, /from '\.\.\/utils\/qaKpis'/);
  assert.match(view, /widget\.type === 'qa_kpis'/);
  assert.match(view, /blockedKpi\.level === 'fuse'/);
  assert.match(constants, /type: 'qa_kpis'/);
});
