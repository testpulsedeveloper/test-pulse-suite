/**
 * @file bugEstimatedDate.test.js
 * @description "Fecha Estimada de Solución" on bugs (v4.12.3): no day shift on DATETIME fields,
 * strict field mapping, and the date picker saving only once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toEstDateFieldValue, isEstDateFieldName, isDateFieldType } from '../src/resolvers/bugResolvers.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DATETIME fields get 12:00 UTC, which is the same calendar day in Mexico', () => {
  const sent = toEstDateFieldValue('2026-10-30', 'datetime');
  assert.equal(sent, '2026-10-30T12:00:00.000+0000');
  // In Mexico City (UTC-6) that instant is still Oct 30 (06:00), not Oct 29.
  const local = new Date(sent).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  assert.equal(local, '2026-10-30');
  // The old behaviour (bare date on a DATETIME field = 00:00 UTC) lands on the previous day.
  assert.equal(new Date('2026-10-30T00:00:00Z').toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }), '2026-10-29');
});

test('DATE fields get the bare date; clearing sends null', () => {
  assert.equal(toEstDateFieldValue('2026-10-30', 'date'), '2026-10-30');
  assert.equal(toEstDateFieldValue('2026-10-30', null), '2026-10-30');
  assert.equal(toEstDateFieldValue(null, 'datetime'), null);
});

test('only clearly-named estimated solution date fields qualify', () => {
  for (const ok of ['Fecha Estimada de Solución', 'Fecha de solucion', 'Solución estimada', 'Estimated Resolution Date', 'Estimated fix date']) {
    assert.equal(isEstDateFieldName(ok), true, ok);
  }
  for (const no of ['Estimated Hours', 'Estimated Story Points', 'Original estimate', 'Estimated start date', 'Due date']) {
    assert.equal(isEstDateFieldName(no), false, no);
  }
  assert.equal(isDateFieldType('date'), true);
  assert.equal(isDateFieldType('datetime'), true);
  assert.equal(isDateFieldType('number'), false);
});

test('bug panel: picker saves once on blur/Enter, configured field wins, shown value only from it', () => {
  const ui = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/components/BugSlidePanel.jsx'), 'utf8');
  assert.ok(ui.includes('onChange={(e) => setEstDateDraft('), 'changing the date only updates a draft');
  assert.ok(ui.includes('onBlur={() => {'), 'saving happens on blur');
  assert.ok(ui.includes("fieldType: b.estDateFieldType || null"), 'the field type is sent to the backend');
  const be = fs.readFileSync(path.join(ROOT_DIR, 'src/resolvers/bugResolvers.js'), 'utf8');
  assert.ok(be.includes('expand=renderedFields,changelog,names,schema'));
  assert.ok(be.includes('const rawEstDateVal = (f[estDateFieldId] !== undefined'), 'value read only from the chosen field');
  assert.ok(!be.includes("mName.includes('estimated')"), 'no more generic "estimated" match');
});
