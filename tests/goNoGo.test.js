/**
 * @file goNoGo.test.js
 * @description Tests for the Go / No-Go exit criteria (Test Pulse 5.0, v4.43.0).
 * Run with: node --test tests/goNoGo.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoNoGo, isCriticalOrHigh } from '../static/hello-world/src/utils/goNoGo.js';

test('severity matching covers Spanish and English names', () => {
  ['Crítico', 'Bloqueante / Crítico', 'Alto / Mayor', 'High', 'Highest'].forEach(s => assert.equal(isCriticalOrHigh({ severity: s }), true, s));
  ['Medio / Menor', 'Low', 'Baja', ''].forEach(s => assert.equal(isCriticalOrHigh({ severity: s }), false, s));
});

test('everything met is Go', () => {
  const r = evaluateGoNoGo({ passed: 98, failed: 2, blocked: 0, notRun: 0, bugs: [{ isDone: true, severity: 'Crítico' }] });
  assert.equal(r.verdict, 'go');
  assert.equal(r.met, 4);
});

test('low pass rate with nothing critical open is Go con excepción', () => {
  const r = evaluateGoNoGo({ passed: 86, failed: 14, blocked: 0, notRun: 0, bugs: [{ isDone: false, severity: 'Medio' }] });
  assert.equal(r.verdict, 'go-exception');
  assert.equal(r.verdictLabel, 'Go con excepción');
});

test('open Critical/High bugs or pending cases are No-Go', () => {
  assert.equal(evaluateGoNoGo({ passed: 99, failed: 1, notRun: 0, bugs: [{ isDone: false, severity: 'Alto' }] }).verdict, 'no-go');
  assert.equal(evaluateGoNoGo({ passed: 50, notRun: 5 }).verdict, 'no-go');
});

test('empty selection has no criteria', () => {
  const r = evaluateGoNoGo({});
  assert.equal(r.verdict, 'empty');
  assert.equal(r.criteria.length, 0);
});

test('without bug data the bug criterion is left out', () => {
  const r = evaluateGoNoGo({ passed: 100, notRun: 0, includeBugs: false });
  assert.equal(r.total, 3);
  assert.equal(r.criteria.some(c => c.id === 'bugs'), false);
  assert.equal(r.verdict, 'go');
});
