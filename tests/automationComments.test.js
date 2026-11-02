/**
 * @file automationComments.test.js
 * @description Tests for recording Tosca / IArvis results posted as Test Run comments (v4.12.0).
 * Contract: "Integración Tosca → Test Pulse: formato de comentario".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAutomationComment,
  extractCommentContent,
  mentionsAutomationMarker,
  AUTOMATION_MARKER
} from '../src/utils/automationCommentParser.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const JSON_PAYLOAD = '{"testpulse":1,"tool":"Tosca","status":"Failed","executedAt":"2026-10-27T15:30:00Z","environment":"UAT","comment":"Corrida nocturna","externalId":"run-77","iterations":[{"data":"usuario=QA01","status":"Passed"},{"data":"usuario=QA02","status":"Failed","result":"Timeout en checkout","evidences":["it2.png"]}]}';
const TEXT_PART = [
  '📊 Resultado de Ejecución: Failed',
  'Ciclo: CUQ-90 | Caso de Prueba: CUQ-12 | Estado: Failed',
  'Ejecutado por: Automatización IArvis',
  '💬 Comentario: Corrida nocturna',
  '🔁 Iteraciones (2)',
  '- Iteración #1 [usuario=QA01] — Estado: Passed',
  '- Iteración #2 [usuario=QA02] — Estado: Failed',
  '  Comentario / Resultado: Timeout en checkout',
  '  Adjuntos: it2.png, log2.txt'
].join('\n');

test('API v2 wiki comment: the JSON block wins over the text', () => {
  const r = parseAutomationComment(`${TEXT_PART}\n\n{code:json}\n${JSON_PAYLOAD}\n{code}`);
  assert.equal(r.format, 'json');
  assert.equal(r.status, 'Failed');
  assert.equal(r.tool, 'Tosca');
  assert.equal(r.executedAt, '2026-10-27T15:30:00Z');
  assert.equal(r.environment, 'UAT');
  assert.equal(r.externalId, 'run-77');
  assert.deepEqual(r.iterations, [
    { data: 'usuario=QA01', status: 'Passed', result: '', evidences: [] },
    { data: 'usuario=QA02', status: 'Failed', result: 'Timeout en checkout', evidences: ['it2.png'] }
  ]);
});

test('API v3 ADF comment with a codeBlock and Spanish status words', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '📊 Resultado de Ejecución: Passed' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ejecutado por: ', marks: [{ type: 'strong' }] }, { type: 'text', text: 'Automatizacion iarvis' }] },
    { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: '{"testpulse":1,"status":"Aprobado"}' }] }
  ] };
  const r = parseAutomationComment(adf);
  assert.equal(r.format, 'json');
  assert.equal(r.status, 'Passed');
  assert.deepEqual(r.iterations, []);
});

test('text fallback reads status, comment, iterations, results and attachments', () => {
  const r = parseAutomationComment(TEXT_PART);
  assert.equal(r.format, 'text');
  assert.equal(r.status, 'Failed');
  assert.equal(r.comment, 'Corrida nocturna');
  assert.deepEqual(r.iterations, [
    { data: 'usuario=QA01', status: 'Passed', result: '', evidences: [] },
    { data: 'usuario=QA02', status: 'Failed', result: 'Timeout en checkout', evidences: ['it2.png', 'log2.txt'] }
  ]);
});

test('text fallback accepts a normal hyphen, no data brackets and no emojis', () => {
  const r = parseAutomationComment('Resultado de Ejecucion: Blocked\nEjecutado por: Automatización IArvis\nIteración #1 - Estado: Bloqueado');
  assert.equal(r.status, 'Blocked');
  assert.deepEqual(r.iterations, [{ data: '', status: 'Blocked', result: '', evidences: [] }]);
});

test('Test Pulse own manual comments (ADF with embedded newlines) are NOT automation results', () => {
  const manual = { type: 'doc', version: 1, content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '📊 Resultado de Ejecución: Passed' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ejecutado por: ', marks: [{ type: 'strong' }] }, { type: 'text', text: 'María López' }] }
  ] };
  assert.equal(parseAutomationComment(manual), null);
});

test('invalid or incomplete results are rejected with a reason, never half-applied', () => {
  assert.match(parseAutomationComment(`${AUTOMATION_MARKER}\nResultado de Ejecución: Quizás`).error, /no reconocido/);
  assert.match(parseAutomationComment(`${AUTOMATION_MARKER}\nsin estado`).error, /Resultado de Ejecución/);
  const badIter = `${AUTOMATION_MARKER}\n{code:json}\n{"testpulse":1,"status":"Passed","iterations":[{"status":"Tal vez"}]}\n{code}`;
  assert.match(parseAutomationComment(badIter).error, /iteración #1/);
});

test('invalid JSON falls back to the text part', () => {
  const r = parseAutomationComment(`${TEXT_PART}\n{code:json}\n{"testpulse":1,"status":"Passed",}\n{code}`);
  assert.equal(r.format, 'text');
  assert.equal(r.status, 'Failed');
});

test('marker pre-check and ADF extraction helpers', () => {
  assert.equal(mentionsAutomationMarker({ text: 'ejecutado por: AUTOMATIZACIÓN iArvis' }), true);
  assert.equal(mentionsAutomationMarker('Comentario normal'), false);
  assert.equal(mentionsAutomationMarker(undefined), false);
  const { lines, codeBlocks } = extractCommentContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
    { type: 'codeBlock', content: [{ type: 'text', text: '{"x":1}' }] }
  ] });
  assert.deepEqual(lines.filter(Boolean), ['a', 'b']);
  assert.deepEqual(codeBlocks, ['{"x":1}']);
});

test('wiring: comment trigger, idempotent ingestion, manual comments never overwrite automation', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('export const automationCommentHandler = async (event) =>'));
  assert.ok(src.includes("if (ingested.includes(commentId)) return { status: 'skipped', reason: 'already-ingested' };"));
  assert.ok(src.includes("executionType: 'Automated',"));
  assert.ok(src.includes('if (parseAutomationComment(c.body)) return false;'), 'syncExecutionComment skips automation comments');
  assert.ok(src.includes("resolver.define('reprocessAutomationComments'"));
  assert.ok(src.includes('automation: runData.automation || null,'), 'cycle list receives the automation info');
  const m = fs.readFileSync(path.join(ROOT_DIR, 'manifest.yml'), 'utf8');
  assert.ok(/- avi:jira:commented:issue\n\s+filter:\n\s+ignoreSelf: true/.test(m));
  assert.ok(m.includes('handler: index.automationCommentHandler'));
  const ui = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/views/ExecutionView.jsx'), 'utf8');
  assert.ok(ui.includes("invoke('reprocessAutomationComments'"));
  assert.ok(ui.includes('focusedCommentId='));
});

test('text copied from Jira screen with all labels on ONE line (real comment 771701, v4.12.1)', () => {
  const oneLine = '📊 Resultado de Ejecución: Passed Ciclo: CUQ-90 | Caso de Prueba: CUQ-12 | Estado: Passed '
    + 'Ejecutado por: Automatización IArvis 💬 Comentario: Corrida 3 🔁 Iteraciones (2) '
    + 'Iteración #1 [d1] — Estado: Passed Comentario / Resultado: Detalles de la prueba 1 '
    + 'Iteración #2 — Estado: Passed Comentario / Resultado: Detalles de la prueba 2 Adjuntos: ticket.pdf';
  const r = parseAutomationComment(oneLine);
  assert.equal(r.format, 'text');
  assert.equal(r.status, 'Passed');
  assert.equal(r.comment, 'Corrida 3');
  assert.deepEqual(r.iterations, [
    { data: 'd1', status: 'Passed', result: 'Detalles de la prueba 1', evidences: [] },
    { data: '', status: 'Passed', result: 'Detalles de la prueba 2', evidences: ['ticket.pdf'] }
  ]);
});

// ── v4.13.0: any automation tool ──
import { normalizeToolName, AUTOMATION_TOOLS } from '../src/utils/automationCommentParser.js';

test('generic marker: the tool is the name after "Automatización"', () => {
  const cases = [
    ['Ejecutado por: Automatización Playwright', 'Playwright'],
    ['Ejecutado por: automatizacion SELENIUM WEBDRIVER', 'Selenium'],
    ['Ejecutado por: Automatización Mantis', 'Mantis'],
    ['Ejecutado por: Automatización IArvis', 'Tosca'],
    ['Ejecutado por: Automatización MiHerramientaQA', 'MiHerramientaQA'],
    ['Ejecutado por: Automatización', 'Automatización']
  ];
  for (const [marker, tool] of cases) {
    const r = parseAutomationComment(`📊 Resultado de Ejecución: Passed\n${marker}`);
    assert.equal(r.tool, tool, marker);
    assert.equal(r.status, 'Passed');
  }
});

test('JSON block alone is enough; its `tool` wins and is normalised', () => {
  const r = parseAutomationComment('{code:json}\n{"testpulse":1,"tool":"cypress","status":"Blocked"}\n{code}');
  assert.equal(r.format, 'json');
  assert.equal(r.tool, 'Cypress');
  const both = parseAutomationComment('Ejecutado por: Automatización Selenium\n{code:json}\n{"testpulse":1,"tool":"Playwright","status":"Passed"}\n{code}');
  assert.equal(both.tool, 'Playwright');
  const noTool = parseAutomationComment('{code:json}\n{"testpulse":1,"status":"Passed"}\n{code}');
  assert.equal(noTool.tool, 'Automatización');
});

test('tool catalog: aliases, unknown tools kept, empty values rejected', () => {
  assert.equal(normalizeToolName('Tricentis-Tosca'), 'Tosca');
  assert.equal(normalizeToolName('wdio'), 'WebdriverIO');
  assert.equal(normalizeToolName('robot_framework'), 'Robot Framework');
  assert.equal(normalizeToolName('newman'), 'Postman');
  assert.equal(normalizeToolName('  Herramienta Nueva  '), 'Herramienta Nueva');
  assert.equal(normalizeToolName('x'.repeat(80)).length, 40);
  assert.equal(normalizeToolName(''), null);
  assert.ok(AUTOMATION_TOOLS.some(t => t.name === 'Mantis'));
});

test('manual executions and ordinary comments are never treated as automation', () => {
  assert.equal(parseAutomationComment('📊 Resultado de Ejecución: Passed\nEjecutado por: María López'), null);
  assert.equal(parseAutomationComment('Hablamos de automatización mañana'), null);
  const src = fs.readFileSync(path.join(ROOT_DIR, 'src/index.js'), 'utf8');
  assert.ok(src.includes('if (parseAutomationComment(c.body)) return false;'), 'manual sync only skips real automation results');
  const m = fs.readFileSync(path.join(ROOT_DIR, 'manifest.yml'), 'utf8');
  assert.ok(/path: automation\.tool\n\s+type: string\n\s+searchAlias: tpTool/.test(m), 'tool is searchable with JQL');
});
