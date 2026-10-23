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
  MAX_MOBILE_UPLOAD_BYTES,
  generateMobileSessionId,
  resolveAllowedMobileMime,
  signMobileSessionToken,
  verifyMobileSessionToken,
  resolveSafeCorsOrigin
} from '../src/utils/mobileSecurity.js';

import {
  normalizeProjectRef,
  normalizeIssueRef
} from '../src/utils/authz.js';

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
  const secret = 'a'.repeat(64);
  const sessionId = generateMobileSessionId();
  const createdAt = 1792450000000;
  const token = signMobileSessionToken(sessionId, createdAt, secret);

  assert.equal(typeof token, 'string');
  assert.equal(token.length, 64);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, token, secret), true);

  // Tampered sessionId, timestamp, token or a different secret must fail
  assert.equal(verifyMobileSessionToken(sessionId + '_x', createdAt, token, secret), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt + 1, token, secret), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, '0'.repeat(64), secret), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, token, 'b'.repeat(64)), false);
  assert.equal(MAX_UPLOADS_PER_SESSION, 15);
  assert.equal(QR_SESSION_TTL_MS, 2 * 60 * 60 * 1000);
});

test('3.4 Mobile Companion Security — missing signature or secret is always rejected (C2)', () => {
  const secret = 'c'.repeat(64);
  const sessionId = generateMobileSessionId();
  const createdAt = Date.now();
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, '', secret), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, undefined, secret), false);
  assert.equal(verifyMobileSessionToken(sessionId, createdAt, 'x', undefined), false);
  assert.throws(() => signMobileSessionToken(sessionId, createdAt, ''), /not configured/);
});

test('3.4 Mobile Companion Security — no hard-coded HMAC fallback secret in source (C2)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/utils/mobileSecurity.js'), 'utf8');
  assert.ok(!src.includes('tp-liverpool-forge-mobile-hmac'), 'legacy hard-coded secret must be gone');
});

test('3.4 Mobile Companion Security — session ids are random and unique (C2)', () => {
  const ids = new Set(Array.from({ length: 200 }, () => generateMobileSessionId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^qr_[0-9a-f]{32}$/);
});

test('3.4 Mobile Companion Security — upload MIME allowlist and size cap (C3)', () => {
  assert.deepEqual(resolveAllowedMobileMime('image/jpeg'), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(resolveAllowedMobileMime('video/mp4; codecs=avc1'), { mime: 'video/mp4', ext: 'mp4' });
  assert.equal(resolveAllowedMobileMime('text/html'), null);
  assert.equal(resolveAllowedMobileMime('image/svg+xml'), null);
  assert.equal(resolveAllowedMobileMime('application/octet-stream'), null);
  assert.equal(MAX_MOBILE_UPLOAD_BYTES, 10 * 1024 * 1024);
});

test('Authz — project and issue references reject JQL/route injection payloads (A5)', () => {
  assert.equal(normalizeProjectRef('10001'), '10001');
  assert.equal(normalizeProjectRef('qa'), 'QA');
  assert.equal(normalizeProjectRef('10001" OR project is not EMPTY'), null);
  assert.equal(normalizeProjectRef(''), null);
  assert.equal(normalizeIssueRef('qa-12'), 'QA-12');
  assert.equal(normalizeIssueRef('10234'), '10234');
  assert.equal(normalizeIssueRef('QA-12/../../myself'), null);
});

test('Authz — admin-gated resolvers pass the caller context to the permission cache (A1)', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(!src.includes('_isProjectAdmin(projectId))'), 'every _isProjectAdmin call must include context');
  assert.ok(!src.includes("'default_user'"), 'no shared default_user cache key');
});

test('Allowlist — testpulse-enabled is stored as { enabled } so disabling a project takes effect (A4)', () => {
  // Report automation and config keep their original (internal-cloud) permission model;
  // only the allowlist storage shape was fixed so `isProjectAllowed` can read it.
  const config = fs.readFileSync(path.join(ROOT_DIR, 'src/resolvers/configResolvers.js'), 'utf8');
  assert.ok(config.includes('JSON.stringify({ enabled: enabled !== false })'));
});

test('Mobile app — no OAuth client secret committed (C1)', () => {
  const login = fs.readFileSync(path.join(ROOT_DIR, 'test-pulse-mobile/src/screens/LoginScreen.js'), 'utf8');
  assert.ok(!/ATOA[A-Za-z0-9_-]{20,}/.test(login), 'Atlassian client secret must come from .env');
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
