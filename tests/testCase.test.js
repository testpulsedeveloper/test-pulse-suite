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
import { adfToPlainText, plainTextToAdf, buildTestCaseFields, buildFormOptions, MAX_DESCRIPTION_CHARS } from '../src/utils/testCaseText.js';

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
  // No link in App.js (Design and its side panel) opens the Jira issue view any more.
  assert.doesNotMatch(app, /\/browse\//);
  assert.doesNotMatch(app, /Abrir en Jira|Editar en Jira/);

  const editor = read('static/hello-world/src/components/TestCaseEditor.jsx');
  for (const label of ['Resumen', 'Descripción', 'is tested by', 'Épica', 'Nivel de Prueba', 'Tipo de Prueba', 'Tipo de Ejecución', 'Prioridad', 'Carpeta']) {
    assert.ok(editor.includes(label), `the form has the field "${label}"`);
  }
});

test('list options come from Jira metadata; disabled options and missing fields are handled (v4.23.1)', () => {
  const options = buildFormOptions({
    priority: { required: false, allowedValues: [{ id: '1', name: 'High' }, { id: '2', name: 'Medium' }] },
    customfield_10530: { required: true, schema: { type: 'option' }, allowedValues: [{ id: '9', value: 'Integración SIT' }, { id: '8', value: 'Viejo', disabled: true }] },
    customfield_10534: { schema: { type: 'array' }, allowedValues: [{ id: '5', value: 'Manual' }] },
    parent: {}
  }, FIELD_IDS);
  assert.deepEqual(options.priority.options, [{ id: '1', label: 'High' }, { id: '2', label: 'Medium' }]);
  assert.deepEqual(options.testLevel, { available: true, required: true, multiple: false, options: [{ id: '9', label: 'Integración SIT' }] });
  assert.equal(options.executionType.multiple, true);
  // A field Jira does not offer on this screen is reported as not available, with no options.
  assert.deepEqual(options.testType, { available: false, required: false, multiple: false, options: [] });
  assert.equal(options.epic.available, true);
  assert.equal(buildFormOptions(null, FIELD_IDS).priority.available, false);
});

test('the epic of a case is its Jira parent (v4.23.1)', () => {
  assert.deepEqual(buildTestCaseFields({ epicKey: 'demo-12' }, FIELD_IDS).fields, { parent: { key: 'DEMO-12' } });
  assert.deepEqual(buildTestCaseFields({ epicKey: '' }, FIELD_IDS).fields, { parent: null });
  assert.match(buildTestCaseFields({ epicKey: 'no es clave' }, FIELD_IDS).errors[0], /épica/);
});

test('the case is edited in its side panel: title, description, properties, story and epic (v4.23.1)', () => {
  const resolvers = read('src/resolvers/testCaseResolvers.js');
  // One request brings values, list options and allowed statuses.
  assert.match(resolvers, /expand=editmeta,transitions/);
  // Jira Cloud names the create metadata `issueTypes` / `fields`; every page of fields is read.
  assert.match(resolvers, /typesData\.issueTypes \|\| typesData\.values/);
  assert.match(resolvers, /data\.fields \|\| data\.values/);
  assert.match(resolvers, /\/transitions`, \{\s*method: 'POST'/);

  const app = read('static/hello-world/src/App.js');
  assert.match(app, /useTestCaseInlineEdit\(\{/);
  assert.match(app, /<EditableCaseTitle edit=\{caseEdit\}/);
  assert.match(app, /<EditableCaseDescription edit=\{caseEdit\} \/>/);
  assert.match(app, /<EditableCaseProperties edit=\{caseEdit\}/);
  // Editing a property must not re-read the description: the effect depends on the case id.
  assert.match(app, /\[selectedTestCase\?\.id, descriptionReloadKey\]/);

  const inline = read('static/hello-world/src/components/TestCaseInlineEdit.jsx');
  for (const label of ['Estado', 'Prioridad', 'Nivel de Prueba', 'Tipo de Prueba', 'Tipo de Ejecución', 'Historia que prueba', 'Épica']) {
    assert.ok(inline.includes(label), `the panel edits "${label}"`);
  }
});

test('nothing becomes editable or is written until "Editar" and "Guardar" are pressed (v4.23.2)', () => {
  const inline = read('static/hello-world/src/components/TestCaseInlineEdit.jsx');
  // Opening a case makes no request to prepare editing: the data is read when "Editar" is pressed.
  assert.doesNotMatch(inline, /setTimeout/);
  assert.match(inline, /const startPropertiesEdit = async \(\) => \{\s*const loaded = await ensureLoaded\('properties'\)/);
  assert.match(inline, /const startDescriptionEdit = async \(\) => \{\s*const loaded = await ensureLoaded\('description'\)/);
  // Changing a list only updates the draft; saveTestCase is called from save() alone, and the
  // properties are saved by savePropertiesEdit with the changed fields only.
  assert.equal((inline.match(/invoke\('saveTestCase'/g) || []).length, 1);
  assert.match(inline, /onChange=\{\(id\) => edit\.setProp\('priorityId', id\)\}/);
  assert.match(inline, /const changed = changedProps\(\);\s*if \(changed\.length === 0\) \{ setPropsDraft\(null\); return; \}/);
  // The current value is always offered, so opening the editor never shows a value the case lacks.
  assert.match(inline, /currentMissing && <option value=\{current\.id\}>/);

  const app = read('static/hello-world/src/App.js');
  assert.match(app, /\{caseEdit\.propsEditing \? \(/);
  assert.match(app, /<EditLink onClick=\{caseEdit\.startPropertiesEdit\}/);
  assert.match(app, /<EditLink onClick=\{caseEdit\.startDescriptionEdit\}/);
  assert.doesNotMatch(app, /caseEdit\.ready/);

  // The backend returns the label of each current value (needed to show it).
  const resolvers = read('src/resolvers/testCaseResolvers.js');
  assert.match(resolvers, /priorityName: String\(fields\.priority\?\.name \|\| ''\)/);
  assert.match(resolvers, /return \{ optionId: String\(value\.id \?\? ''\), label, multiple: false \}/);
});
