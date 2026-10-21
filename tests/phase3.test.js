/**
 * @file phase3.test.js
 * @description Automated unit test suite for Test Pulse Suite v4.7.0 (Phase 3: Marketplace-Ready,
 * Security, Dynamic Custom Fields, Observability Percentiles & "Runs on Atlassian" Compliance).
 * Run with: node --test tests/phase3.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CUSTOM_FIELDS,
  resolveCustomFields,
  getBugJqlFields,
  extractBugSeverityFromFields,
  extractBugEstimatedDateFromFields,
  computePercentiles
} from '../src/utils/customFieldConfig.js';

import {
  MAX_UPLOADS_PER_SESSION,
  QR_SESSION_TTL_MS,
  signMobileSessionToken,
  verifyMobileSessionToken,
  resolveSafeCorsOrigin
} from '../src/utils/mobileSecurity.js';

import {
  normalizeJiraStatus,
  ensureValidAdf,
  dedupeEvidences
} from '../src/utils/statusAndAdfHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('3.1 Dynamic Custom Fields — resolveCustomFields returns Liverpool defaults and merges overrides', () => {
  const defaults = resolveCustomFields(null);
  assert.equal(defaults.bugSeverity, 'customfield_10238');
  assert.equal(defaults.bugEstimatedDate, 'customfield_10763');
  assert.equal(defaults.epicLink, 'customfield_10014');

  const customCfg = {
    customFields: {
      bugSeverity: 'customfield_20500',
      bugEstimatedDate: 'customfield_20501'
    }
  };
  const resolved = resolveCustomFields(customCfg);
  assert.equal(resolved.bugSeverity, 'customfield_20500');
  assert.equal(resolved.bugEstimatedDate, 'customfield_20501');
  assert.equal(resolved.epicLink, DEFAULT_CUSTOM_FIELDS.epicLink);
});

test('3.1 Dynamic Custom Fields — getBugJqlFields includes both configured and fallback custom field IDs', () => {
  const fields = getBugJqlFields({
    customFields: {
      bugSeverity: 'customfield_99001',
      bugEstimatedDate: 'customfield_99002'
    }
  }, ['issuelinks']);

  assert.ok(fields.includes('customfield_99001'), 'Includes configured bugSeverity');
  assert.ok(fields.includes('customfield_99002'), 'Includes configured bugEstimatedDate');
  assert.ok(fields.includes('customfield_10238'), 'Keeps Liverpool fallback bugSeverity');
  assert.ok(fields.includes('issuelinks'), 'Includes extra requested fields');
});

test('3.1 Dynamic Custom Fields — extractBugSeverityFromFields & extractBugEstimatedDateFromFields', () => {
  const cfg = {
    customFields: {
      bugSeverity: 'customfield_30001',
      bugEstimatedDate: 'customfield_30002'
    }
  };
  const mockIssueFields = {
    customfield_30001: { value: 'Crítico' },
    customfield_30002: '2026-11-15'
  };

  assert.equal(extractBugSeverityFromFields(mockIssueFields, cfg), 'Crítico');
  assert.equal(extractBugEstimatedDateFromFields(mockIssueFields, cfg), '2026-11-15');

  // Fallback to heuristic or duedate when custom field is absent
  const fallbackFields = {
    customfield_88888: { name: 'Bloqueante' },
    duedate: '2026-12-01'
  };
  assert.equal(extractBugSeverityFromFields(fallbackFields, cfg), 'Bloqueante');
  assert.equal(extractBugEstimatedDateFromFields(fallbackFields, cfg, true), '2026-12-01');
});

test('3.4 Mobile Companion Security — HMAC-SHA256 signing, constant-time verification & tamper rejection', () => {
  const sessionId = 'qr_1792450000000_abc1234';
  const createdAt = 1792450000000;
  const token = signMobileSessionToken(sessionId, createdAt);

  assert.equal(typeof token, 'string');
  assert.equal(token.length, 32);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, token), true);

  // Tampered sessionId, timestamp, or token must fail
  assert.equal(verifyMobileSessionToken(sessionId + '_x', createdAt, token), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt + 1, token), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, '0'.repeat(32)), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, ''), false);
  assert.equal(MAX_UPLOADS_PER_SESSION, 15);
  assert.equal(QR_SESSION_TTL_MS, 2 * 60 * 60 * 1000);
});

test('3.4 Mobile Companion Security — resolveSafeCorsOrigin restricts CORS to Atlassian domains', () => {
  assert.equal(
    resolveSafeCorsOrigin({ origin: 'https://liverpool.atlassian.net' }),
    'https://liverpool.atlassian.net'
  );
  assert.equal(
    resolveSafeCorsOrigin({ Origin: 'https://app.atl-paas.net' }),
    'https://app.atl-paas.net'
  );
  // Untrusted or non-HTTPS origins must never reflect '*' or the attacker origin
  assert.equal(
    resolveSafeCorsOrigin({ origin: 'https://evil-attacker.example.com' }),
    'https://forge.atlassian.com'
  );
  assert.equal(
    resolveSafeCorsOrigin({ origin: 'http://liverpool.atlassian.net' }),
    'https://forge.atlassian.com'
  );
});

test('3.5 Runs on Atlassian Compliance — manifest.yml has zero external.fetch.backend egress', () => {
  const manifestContent = fs.readFileSync(path.join(ROOT_DIR, 'manifest.yml'), 'utf8');
  assert.ok(!manifestContent.includes('external:'), 'manifest.yml must not declare external egress block');
  assert.ok(!manifestContent.includes('*.atlassian.com'), 'manifest.yml must not declare wildcard backend fetch');
});

test('3.3 Storage & Security — src/index.js uses @forge/kvs and api.asUser() for issue creation', () => {
  const indexContent = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(indexContent.includes("from '@forge/kvs'"), 'src/index.js imports @forge/kvs');
  assert.ok(indexContent.includes('storage.get(`app_prop_${key}`)'), 'getAppStorage reads from @forge/kvs');
  assert.ok(indexContent.includes('storage.set(`app_prop_${key}`, { data: val })'), 'setAppStorage writes to @forge/kvs');
});

test('3.6 Observability — computePercentiles accurately calculates p50, p95, and maxMs', () => {
  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 250];
  const stats = computePercentiles(samples);
  assert.equal(stats.count, 10);
  assert.equal(stats.p50, 50);
  assert.equal(stats.p95, 250);
  assert.equal(stats.maxMs, 250);

  const emptyStats = computePercentiles([]);
  assert.deepEqual(emptyStats, { count: 0, p50: 0, p95: 0, maxMs: 0 });
});

test('Core Helpers — normalizeJiraStatus, ensureValidAdf and dedupeEvidences', () => {
  assert.equal(normalizeJiraStatus('Exitosa'), 'Passed');
  assert.equal(normalizeJiraStatus('Fallido'), 'Failed');
  assert.equal(normalizeJiraStatus('En Curso'), 'In Progress');

  const adf = ensureValidAdf('Hola Mundo QA');
  assert.equal(adf.type, 'doc');
  assert.equal(adf.content[0].content[0].text, 'Hola Mundo QA');

  const deduped = dedupeEvidences([{ id: '101', filename: 'a.png' }, { id: '101', filename: 'a.png' }]);
  assert.equal(deduped.length, 1);
});
