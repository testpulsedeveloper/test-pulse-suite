/**
 * @file runDataContract.test.js
 * @description Tests for the `testpulse-run-data` v2 contract and the phase 0 wiring
 * (Opción A): indexed fields, manifest modules and SQL migrations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampRunDataV2, toIsoDate, RUN_DATA_SCHEMA_VERSION } from '../src/utils/runDataContract.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-23T18:00:00.000Z');

test('v2 stamp keeps every v1 field and adds the indexed fields', () => {
  const v1 = {
    testCaseId: '201', testCaseKey: 'CUQ-12', cycleId: 10500, cycleKey: 'CUQ-90', status: 'Passed',
    executedBy: { accountId: 'acc-1', displayName: 'Ana' }, executedAt: Date.parse('2026-10-20T15:30:00Z'),
    evidences: [{ id: '9', filename: 'a.png' }], iterations: [], comment: 'ok'
  };
  const v2 = stampRunDataV2(v1, '10010', NOW);
  for (const [k, v] of Object.entries(v1)) {
    if (k !== 'cycleId') assert.deepEqual(v2[k], v, `v1 field ${k} unchanged`);
  }
  assert.equal(v2.schemaVersion, RUN_DATA_SCHEMA_VERSION);
  assert.equal(v2.cycleId, '10500');
  assert.equal(v2.activeCycleId, '10500');
  assert.equal(v2.projectId, '10010');
  assert.equal(v2.executedAtIso, '2026-10-20T15:30:00.000Z');
  assert.equal(v2.updatedAt, NOW.toISOString());
  assert.equal(typeof v2.executedAt, 'number', 'executedAt stays epoch ms for the frontend');
});

test('runs removed from a cycle keep cycleId but are not indexed as active', () => {
  const v2 = stampRunDataV2({ cycleId: '10500', unlinkedFromCycle: true, status: 'Failed' }, null, NOW);
  assert.equal(v2.cycleId, '10500');
  assert.equal(v2.activeCycleId, null);
  const relinked = stampRunDataV2({ ...v2, unlinkedFromCycle: false }, null, NOW);
  assert.equal(relinked.activeCycleId, '10500');
});

test('existing projectId wins; stamping is idempotent apart from updatedAt', () => {
  const first = stampRunDataV2({ cycleId: '1', projectId: '777' }, '10010', NOW);
  assert.equal(first.projectId, '777');
  const later = new Date('2026-10-24T00:00:00.000Z');
  const second = stampRunDataV2(first, null, later);
  assert.deepEqual({ ...second, updatedAt: null }, { ...first, updatedAt: null });
  assert.equal(second.updatedAt, later.toISOString());
});

test('toIsoDate accepts epoch ms, numeric strings and ISO; rejects junk', () => {
  assert.equal(toIsoDate(0), '1970-01-01T00:00:00.000Z');
  assert.equal(toIsoDate('1792450000000'), new Date(1792450000000).toISOString());
  assert.equal(toIsoDate('2026-10-20T15:30:00Z'), '2026-10-20T15:30:00.000Z');
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate(''), null);
  assert.equal(toIsoDate('not a date'), null);
  assert.equal(stampRunDataV2(null, null, NOW).executedAtIso, null);
});

test('every testpulse-run-data write goes through the v2 stamp', () => {
  for (const rel of ['src/index.js', 'src/resolvers/mobileCompanionResolvers.js']) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    const writes = src.split('properties/testpulse-run-data`').slice(1);
    for (const after of writes) {
      const window = after.slice(0, 400);
      if (!/method: 'PUT'/.test(window)) continue;
      assert.ok(window.includes('stampRunDataV2('), `${rel}: a PUT of testpulse-run-data is not stamped`);
    }
  }
});

test('manifest declares the entityProperty index, the SQL module and the migrations trigger', () => {
  const m = fs.readFileSync(path.join(ROOT_DIR, 'manifest.yml'), 'utf8');
  assert.ok(m.includes('jira:entityProperty:'));
  assert.ok(m.includes('propertyKey: testpulse-run-data'));
  for (const alias of ['tpCycleId', 'tpProjectId', 'tpStatus', 'tpExecutedAt', 'tpExecutedBy']) {
    assert.ok(m.includes(`searchAlias: ${alias}`), `alias ${alias}`);
  }
  assert.ok(m.includes('path: activeCycleId'), 'tpCycleId indexes activeCycleId, not cycleId');
  assert.ok(!m.includes('keyConfigurations'), 'jira:entityProperty has no keyConfigurations');
  assert.ok(/sql:\n\s+- key: main\n\s+engine: mysql/.test(m));
  assert.ok(m.includes('avi:forge:upgraded:app') && m.includes('handler: index.sqlMigrationsHandler'));
});

test('SQL migrations are uniquely named, ordered and idempotent DDL', async () => {
  const { EXECUTION_INDEX_MIGRATIONS } = await import('../src/sql/executionIndexSchema.js');
  const names = EXECUTION_INDEX_MIGRATIONS.map(([n]) => n);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [...names].sort());
  for (const [, stmt] of EXECUTION_INDEX_MIGRATIONS) assert.match(stmt, /^CREATE TABLE IF NOT EXISTS /);
});
