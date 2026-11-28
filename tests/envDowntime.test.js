/**
 * @file envDowntime.test.js
 * @description Tests for "Ambiente no disponible" reports (Test Pulse 5.0, v4.42.0).
 * Run with: node --test tests/envDowntime.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEvent, addEvent, closeEvent, normalizeTicket, downtimeHoursByEnv, MAX_EVENTS, storageKey } from '../src/utils/envDowntime.js';

const t0 = new Date('2026-11-30T15:00:00Z');
// Made-up environment and account ids (no real data).
const qa = { envId: 'env-qa', envName: 'QA' };

test('ticket accepts a Jira key or an https link and rejects anything else', () => {
  assert.equal(normalizeTicket(' inc-123 '), 'INC-123');
  assert.equal(normalizeTicket('https://example.atlassian.net/browse/INC-1'), 'https://example.atlassian.net/browse/INC-1');
  assert.equal(normalizeTicket(''), '');
  assert.throws(() => normalizeTicket('javascript:alert(1)'));
  assert.throws(() => normalizeTicket('se cayó'));
});

test('an event needs an environment and stores only the reporter accountId', () => {
  assert.throws(() => buildEvent({}, 'acc-1', t0));
  const e = buildEvent({ ...qa, component: 'Autorizador', ticket: 'INC-9' }, 'acc-1', t0);
  assert.equal(e.startedBy, 'acc-1');
  assert.equal(e.endedAt, null);
  assert.equal(e.component, 'Autorizador');
  assert.equal(Object.keys(e).some(k => /name/i.test(k) && k !== 'envName'), false);
});

test('a second open report for the same env and component is refused; another component is fine', () => {
  const a = buildEvent(qa, 'acc-1', t0);
  const list = addEvent([], a);
  assert.throws(() => addEvent(list, buildEvent(qa, 'acc-2', t0)));
  const withComponent = addEvent(list, buildEvent({ ...qa, component: 'OMS' }, 'acc-2', t0));
  assert.equal(withComponent.length, 2);
});

test('closing marks the event restored once; the list is capped', () => {
  const a = buildEvent(qa, 'acc-1', t0);
  const closed = closeEvent([a], a.id, 'acc-2', new Date('2026-11-30T17:00:00Z'));
  assert.equal(closed[0].endedBy, 'acc-2');
  assert.throws(() => closeEvent(closed, a.id, 'acc-2'));
  assert.throws(() => closeEvent(closed, 'missing', 'acc-2'));
  const many = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({ id: `x${i}`, envId: 'e', component: `c${i}`, endedAt: 'x' }));
  assert.equal(addEvent(many, buildEvent(qa, 'acc-1', t0)).length, MAX_EVENTS);
  assert.equal(storageKey(10001), 'tp5-env-downtime:10001');
});

test('downtime hours merge overlaps and count open events until the end of the range', () => {
  const ev = (s, f) => ({ envId: 'env-qa', startedAt: s, endedAt: f });
  const hours = downtimeHoursByEnv([
    ev('2026-11-30T10:00:00Z', '2026-11-30T12:00:00Z'),
    ev('2026-11-30T11:00:00Z', '2026-11-30T13:00:00Z'), // overlaps: total 3 h
    ev('2026-11-30T20:00:00Z', null)                     // open: counts until 22:00
  ], '2026-11-30T00:00:00Z', '2026-11-30T22:00:00Z');
  assert.equal(hours['env-qa'], 5);
});

test('resolvers check project access before touching storage', () => {
  const src = fs.readFileSync(new URL('../src/resolvers/envDowntimeResolvers.js', import.meta.url), 'utf8');
  assert.equal((src.match(/await requireProjectAccess\(payload\?\.projectId, context\)/g) || []).length, 3);
  assert.ok(!/displayName/.test(src), 'no names are stored or logged');
});
