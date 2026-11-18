/**
 * @file designTotals.test.js
 * @description Tests for the counters of phase 02 "Diseñar" in Lifecycle (v4.32.0).
 * Run with: node --test tests/designTotals.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { designTotals, designState, reportDocumentName } from '../static/hello-world/src/utils/designTotals.js';

// Made-up documents (no real data): two read reports, one never read, one with an error.
const report = (total, open, closed, openByImpact = {}, maturityPct = null) => ({ totals: { total, open, closed, openByImpact }, maturityPct });
const docs = [
  { id: 'a', status: 'delivered', report: report(10, 4, 6, { 'Crítico': 1, 'Alto': 2, 'Medio': 1 }, 70) },
  { id: 'b', status: 'in_progress', report: report(5, 0, 5, {}, 90) },
  { id: 'c', status: 'pending' },
  { id: 'd', status: 'pending', report: { error: 'La página no existe.' } }
];

test('adds the findings of every read report', () => {
  const totals = designTotals(docs);
  assert.equal(totals.documents, 4);
  assert.equal(totals.read, 2);
  assert.equal(totals.unread, 2);
  assert.equal(totals.delivered, 1);
  assert.equal(totals.total, 15);
  assert.equal(totals.open, 4);
  assert.equal(totals.closed, 11);
  assert.equal(totals.seriousOpen, 3);
  assert.equal(totals.maturityAvg, 80);
  assert.equal(totals.closedPct, 73);
});

test('no documents gives zeros and no average', () => {
  const totals = designTotals(undefined);
  assert.equal(totals.documents, 0);
  assert.equal(totals.total, 0);
  assert.equal(totals.closedPct, 0);
  assert.equal(totals.maturityAvg, null);
  assert.equal(designState(totals).label, 'Sin documentos');
});

test('state follows open findings and unread documents', () => {
  assert.equal(designState(designTotals(docs)).label, 'Con hallazgos abiertos');
  assert.equal(designState(designTotals([docs[2]])).label, 'Sin leer');
  assert.equal(designState(designTotals([docs[1], docs[2]])).label, 'Documentos sin leer');
  assert.equal(designState(designTotals([docs[1]])).label, 'Hallazgos atendidos');
});

test('document name comes from the report header, then from the page title', () => {
  assert.equal(reportDocumentName({ general: { documentName: 'ERF Pagos Ficticios' }, pageTitle: 'Página' }), 'ERF Pagos Ficticios');
  assert.equal(reportDocumentName({ general: {}, pageTitle: 'Reporte de hallazgos – Demo' }), 'Reporte de hallazgos – Demo');
  assert.equal(reportDocumentName(undefined), '');
});
