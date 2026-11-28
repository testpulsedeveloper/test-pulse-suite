/**
 * @file initiativeSummary.test.js
 * @description Tests for "Iniciativas en curso" on Inicio (Test Pulse 5.0, v4.43.0).
 * Run with: node --test tests/initiativeSummary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInitiative } from '../static/hello-world/src/utils/initiativeSummary.js';

const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
// Made-up initiative (no real data).
const initiative = {
  epicKeys: ['EP-1'], planKeys: ['TP-9'],
  phases: {
    plan: { deliverables: [{ status: 'delivered' }] },
    design: { deliverables: [{ status: 'delivered', report: { totals: { open: 2, openByImpact: { Medio: 2 } } } }, { status: 'in_progress', report: { totals: { open: 0 } } }] },
    release: { deliverables: [] }
  }
};

test('manual phases and findings', () => {
  const s = byId(summarizeInitiative(initiative, null));
  assert.equal(s.plan.label, 'Completo');
  assert.equal(s.design.label, '2 docs · 2 abiertos');
  assert.equal(s.design.tone, 'warning');
  assert.equal(s.release.label, 'Pendiente');
  assert.equal(s.build.label, 'Cargando…');
});

test('a critical open finding turns Diseñar red', () => {
  const i = { phases: { design: { deliverables: [{ report: { totals: { open: 1, openByImpact: { 'Crítico': 1 } } } }] } } };
  assert.equal(byId(summarizeInitiative(i, null)).design.label, '1 crítico abierto');
});

test('coverage and execution from progress; plans win over epic runs', () => {
  const s = byId(summarizeInitiative(initiative, {
    stories: 10, storiesWithCases: 9,
    runs: { total: 50, passed: 50 },
    plans: [{ totals: { total: 100, passed: 40, failed: 10, blocked: 4 } }]
  }));
  assert.equal(s.build.label, '90% cobertura');
  assert.equal(s.execute.label, '54% ejecutado');
  assert.equal(byId(summarizeInitiative({}, null)).build.label, 'Sin épicas');
});
