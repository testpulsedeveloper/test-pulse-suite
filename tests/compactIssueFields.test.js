/**
 * @file compactIssueFields.test.js
 * @description v4.14.2: test case `rawFields` are compacted before reaching the browser while every
 * path the UI reads keeps working (App.js, PlanningView.jsx, ReportsView.jsx, traceabilityHelpers.js).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactIssueFields } from '../src/utils/compactIssueFields.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 'https://example.atlassian.net';
const user = { self: `${S}/u`, accountId: 'acc-1', emailAddress: 'ana@x.mx', displayName: 'Ana',
  avatarUrls: { '48x48': 'a48', '24x24': 'a24', '16x16': 'a16', '32x32': 'a32' }, timeZone: 'America/Mexico_City', accountType: 'atlassian', active: true };
const status = { self: `${S}/s`, description: 'catalog text', iconUrl: `${S}/i`, name: 'Por hacer', id: '1',
  statusCategory: { self: `${S}/c`, id: 2, key: 'new', colorName: 'blue-gray', name: 'Por hacer' } };
const issuetype = { self: `${S}/t`, id: '10', description: 'catalog text', iconUrl: `${S}/ti`, name: 'Historia', subtask: false, avatarId: 1, hierarchyLevel: 0 };
const priority = { self: `${S}/p`, iconUrl: `${S}/medium.svg`, name: 'Medium', id: '3' };
const fields = {
  summary: 'Caso', status, created: '2026-10-20T15:30:00.000-0600', labels: ['auto'], priority,
  issuetype: { ...issuetype, name: 'Test Case' },
  reporter: user, creator: user, assignee: { ...user, avatarUrls: { '32x32': 'only32' } },
  parent: { id: '9', key: 'CUQ-500', self: `${S}/i9`, fields: { summary: 'Épica', status, priority, issuetype: { ...issuetype, name: 'Epic' } } },
  issuelinks: [{ id: '77', self: `${S}/l`, type: { id: '1', name: 'Relates', inward: 'relates to', outward: 'relates to', self: `${S}/lt` },
    outwardIssue: { id: '8', key: 'CUQ-700', self: `${S}/i8`, fields: { summary: 'Historia', status, priority, issuetype } } }],
  customfield_10534: { self: `${S}/o`, value: 'Automatizado', id: '5' },
  customfield_10535: [{ self: `${S}/o2`, value: 'Funcional', id: '6' }],
  customfield_10014: 'CUQ-500',
  customfield_text: 'texto libre con description: no se toca'
};

test('every path the UI reads from test case rawFields survives compaction', () => {
  const c = compactIssueFields(fields);
  assert.equal(c.status.name, 'Por hacer');
  assert.equal(c.status.statusCategory.key, 'new');
  assert.equal(c.priority.name, 'Medium');
  assert.equal(c.priority.iconUrl, `${S}/medium.svg`, 'priority icon is shown in the case detail');
  for (const u of [c.reporter, c.creator]) {
    assert.equal(u.displayName, 'Ana');
    assert.equal(u.emailAddress, 'ana@x.mx');
    assert.equal(u.accountId, 'acc-1');
    assert.deepEqual(u.avatarUrls, { '24x24': 'a24' });
  }
  assert.deepEqual(c.assignee.avatarUrls, { '24x24': 'only32' }, '32x32 is the fallback when 24x24 is missing');
  assert.deepEqual(c.labels, ['auto']);
  assert.equal(c.created, fields.created);
  assert.equal(c.parent.key, 'CUQ-500');
  assert.equal(c.parent.fields.summary, 'Épica');
  assert.equal(c.parent.fields.issuetype.name, 'Epic');
  const link = c.issuelinks[0];
  assert.equal(link.type.name, 'Relates');
  assert.equal(link.type.inward, 'relates to');
  assert.equal(link.type.outward, 'relates to');
  assert.equal(link.outwardIssue.key, 'CUQ-700');
  assert.equal(link.outwardIssue.fields.summary, 'Historia');
  assert.equal(link.outwardIssue.fields.issuetype.name, 'Historia');
  assert.equal(link.outwardIssue.fields.status.name, 'Por hacer');
  assert.equal(c.customfield_10534.value, 'Automatizado');
  assert.equal(c.customfield_10535[0].value, 'Funcional');
  assert.equal(c.customfield_10014, 'CUQ-500');
  assert.equal(c.customfield_text, fields.customfield_text);
});

test('data no screen uses is dropped', () => {
  const json = JSON.stringify(compactIssueFields(fields));
  assert.ok(!json.includes('"self"'));
  assert.ok(!json.includes('a48') && !json.includes('a16') && !json.includes('"a32"'));
  assert.ok(!json.includes('catalog text'), 'status / issue type catalog descriptions removed');
  assert.ok(!json.includes(`${S}/ti`) && !json.includes(`${S}/i"`), 'status and issue type icons removed');
  assert.ok(!json.includes('timeZone') && !json.includes('accountType') && !json.includes('hierarchyLevel'));
  assert.ok(json.length < JSON.stringify(fields).length * 0.6, 'at least ~40% smaller on this sample');
});

test('input is not mutated and odd values pass through', () => {
  const copy = JSON.parse(JSON.stringify(fields));
  compactIssueFields(fields);
  assert.deepEqual(fields, copy);
  assert.deepEqual(compactIssueFields(null), {});
  assert.deepEqual(compactIssueFields({ a: null, b: 0, c: false, d: [] }), { a: null, b: 0, c: false, d: [] });
});

test('getTestCases sends compacted fields and measures the compacted size', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('rawFields: compactIssueFields(issue.fields || {})'));
  assert.ok(src.includes('const nextSize = JSON.stringify(nextCases).length;'));
  assert.ok(src.includes('[getTestCases] cases='), 'size per call is logged to verify in production');
});
