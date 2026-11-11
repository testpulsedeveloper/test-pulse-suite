/**
 * @file testCase.test.js
 * @description v4.23.0: Test Cases are created and edited from Design, without Jira's own screens.
 * All names and values here are made up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adfToPlainText, plainTextToAdf, buildTestCaseFields, MAX_DESCRIPTION_CHARS } from '../src/utils/testCaseText.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');

const FIELD_IDS = { testLevel: 'customfield_10530', testType: 'customfield_10535', executionType: 'customfield_10534' };
const TEMPLATE = [
  'Pre-conditions:',
  'Usuario activo en base de datos.',
  '',
  'Test Script:',
  'Given que el sistema muestra la pantalla de ingreso.',
  'When el usuario ingresa datos correctos.',
  'Then el sistema valida la identidad.'
].join('\n');

test('the template text survives a round trip through Jira format', () => {
  const adf = plainTextToAdf(TEMPLATE);
  assert.equal(adf.type, 'doc');
  // Labels are bold, blank lines are kept as empty paragraphs.
  assert.deepEqual(adf.content[0].content[0], { type: 'text', text: 'Pre-conditions:', marks: [{ type: 'strong' }] });
  assert.deepEqual(adf.content[2], { type: 'paragraph' });
  const back = adfToPlainText(adf);
  assert.equal(back.text, TEMPLATE);
  assert.equal(back.hasRichContent, false);
});

test('an empty description still produces a document Jira accepts', () => {
  for (const empty of ['', '   ', '\n\n', null, undefined]) {
    const adf = plainTextToAdf(empty);
    assert.equal(adf.content.length, 1);
    assert.equal(adf.content[0].content[0].text, ' ');
  }
  assert.deepEqual(adfToPlainText(null), { text: '', hasRichContent: false });
  assert.equal(adfToPlainText(plainTextToAdf('')).text, '');
  // A URL at the start of a line is not mistaken for a label.
  assert.equal(plainTextToAdf('https://example.test/x').content[0].content[0].marks, undefined);
});

test('lists and line breaks become readable text; tables, links and images are flagged', () => {
  const simple = adfToPlainText({ type: 'doc', content: [
    { type: 'heading', content: [{ type: 'text', text: 'Pasos' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos', marks: [{ type: 'em' }] }] }] }
    ] },
    { type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }
    ] }
  ] });
  assert.equal(simple.text, 'Pasos\n- uno\n- dos\n1. a\nb');
  assert.equal(simple.hasRichContent, false);

  const table = adfToPlainText({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'celda' }] }] }
  ] }] }] });
  assert.equal(table.hasRichContent, true);
  assert.equal(table.text, 'celda'); // the text is still shown, nothing readable disappears

  const link = adfToPlainText({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'ver', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] }
  ] }] });
  assert.equal(link.hasRichContent, true);
  assert.equal(adfToPlainText({ type: 'doc', content: [{ type: 'mediaSingle', content: [{ type: 'media' }] }] }).hasRichContent, true);
});

test('only the changed fields are sent to Jira, in the shape each field needs', () => {
  const { fields, errors } = buildTestCaseFields({
    summary: '  Validar   ingreso ',
    priorityId: '2',
    testLevel: { optionId: '10101', multiple: false },
    executionType: { optionId: '10202', multiple: true }
  }, FIELD_IDS);
  assert.deepEqual(errors, []);
  assert.deepEqual(fields, {
    summary: 'Validar ingreso',
    priority: { id: '2' },
    customfield_10530: { id: '10101' },
    customfield_10534: [{ id: '10202' }]
  });
  // Nothing changed → nothing sent (the description, in particular, is left untouched).
  assert.deepEqual(buildTestCaseFields({}, FIELD_IDS), { fields: {}, errors: [] });
  // Clearing a list.
  assert.deepEqual(buildTestCaseFields({ testType: { optionId: '', multiple: false } }, FIELD_IDS).fields, { customfield_10535: null });
  assert.deepEqual(buildTestCaseFields({ testType: { optionId: '', multiple: true } }, FIELD_IDS).fields, { customfield_10535: [] });
  // An empty priority means "keep Jira's default", so it is not sent.
  assert.deepEqual(buildTestCaseFields({ priorityId: '' }, FIELD_IDS).fields, {});
});

test('invalid values from the browser are rejected with a clear message', () => {
  assert.match(buildTestCaseFields({ summary: '   ' }, FIELD_IDS).errors[0], /resumen es obligatorio/);
  assert.match(buildTestCaseFields({ summary: 'x'.repeat(256) }, FIELD_IDS).errors[0], /255/);
  assert.match(buildTestCaseFields({ descriptionText: 'x'.repeat(MAX_DESCRIPTION_CHARS + 1) }, FIELD_IDS).errors[0], /descripción/);
  assert.match(buildTestCaseFields({ priorityId: '2"} , "x' }, FIELD_IDS).errors[0], /prioridad/);
  assert.match(buildTestCaseFields({ testLevel: { optionId: '1; drop' } }, FIELD_IDS).errors[0], /Nivel de Prueba/);
  // A field id that is not a Jira custom field is never used as a key.
  const bad = buildTestCaseFields({ testLevel: { optionId: '1' } }, { testLevel: 'summary' });
  assert.deepEqual(bad.fields, {});
  assert.match(bad.errors[0], /no está configurado/);
});

test('Design creates and edits cases in Test Pulse and no longer sends testers to Jira', () => {
  const resolvers = read('src/resolvers/testCaseResolvers.js');
  // Everything is done as the user, so Jira's own permissions apply.
  assert.doesNotMatch(resolvers, /asApp\(\)/);
  assert.match(resolvers, /resolver\.define\('getTestCaseForEdit'/);
  assert.match(resolvers, /resolver\.define\('saveTestCase'/);
  assert.match(read('src/index.js'), /registerTestCaseResolvers\(resolver\);/);
  // Saving clears the cached reads, so the description shown afterwards is the new one.
  assert.match(read('static/hello-world/src/utils/queryClient.js'), /'saveTestCase',/);

  const app = read('static/hello-world/src/App.js');
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/TestCaseEditor'\)\)/);
  assert.match(app, /setTestCaseEditor\(\{ mode: 'create' \}\)/);
  assert.match(app, /setTestCaseEditor\(\{ mode: 'edit', testCase: selectedTestCase \}\)/);
  // No link in App.js (Design and its side panel) opens the Jira issue view any more.
  assert.doesNotMatch(app, /\/browse\//);
  assert.doesNotMatch(app, /Abrir en Jira|Editar en Jira/);

  const editor = read('static/hello-world/src/components/TestCaseEditor.jsx');
  for (const label of ['Resumen', 'Descripción', 'is tested by', 'Nivel de Prueba', 'Tipo de Prueba', 'Tipo de Ejecución', 'Prioridad']) {
    assert.ok(editor.includes(label), `the form has the field "${label}"`);
  }
});
