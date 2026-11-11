/**
 * @file testCaseText.js
 * @description Converts the description of a Test Case between Jira's rich format (ADF, the
 * "Atlassian Document Format") and the plain text edited in Test Pulse → Design (v4.23.0).
 *
 * Why plain text: the team writes test cases with the same layout as the CSV template —
 *
 *     Pre-conditions:
 *     Usuario activo en base de datos.
 *
 *     Test Script:
 *     Given que el POS muestra la pantalla de ingreso.
 *     When el usuario ingresa un Usuario y Password correctos.
 *     Then el sistema valida la identidad.
 *
 * — so a text box is enough and keeps the edit screen simple. A description that was written in
 * Jira with things plain text cannot keep (tables, images, links, code…) is detected
 * (`hasRichContent`), so the screen can warn before it is replaced.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/testCase.test.js).
 */

// Longest description accepted from the browser (Jira's own limit is 32,767 characters).
export const MAX_DESCRIPTION_CHARS = 30000;

// Blocks plain text can represent without losing anything important.
const SIMPLE_BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'rule']);
// Inline pieces plain text can represent.
const SIMPLE_INLINES = new Set(['text', 'hardBreak']);
// Text styles that may be dropped silently. "strong" is what Test Pulse itself adds to labels
// such as "Pre-conditions:"; emphasis and underline are cosmetic.
const HARMLESS_MARKS = new Set(['strong', 'em', 'underline']);

/**
 * Converts an ADF document to plain text.
 *
 * @param {Object|string|null} adf - Description as returned by Jira (`fields.description`).
 * @returns {{text: string, hasRichContent: boolean}} `hasRichContent` is true when the document
 *          contains something that plain text cannot keep (a table, an image, a link…).
 */
export function adfToPlainText(adf) {
  if (!adf) return { text: '', hasRichContent: false };
  if (typeof adf === 'string') return { text: adf, hasRichContent: false };

  let hasRichContent = false;

  /** Text of the inline children of a block (a paragraph, a heading…). */
  const inlineText = (nodes) => (Array.isArray(nodes) ? nodes : []).map(node => {
    if (!node) return '';
    if (!SIMPLE_INLINES.has(node.type)) {
      hasRichContent = true; // mention, emoji, inline card, media…
      return node.attrs?.text || node.text || '';
    }
    if (node.type === 'hardBreak') return '\n';
    if ((node.marks || []).some(mark => !HARMLESS_MARKS.has(mark?.type))) hasRichContent = true; // link, code, colour…
    return node.text || '';
  }).join('');

  /** Lines of a block, with `prefix` in front of the first one (used for list bullets). */
  const blockLines = (node, prefix = '') => {
    if (!node) return [];
    if (!SIMPLE_BLOCKS.has(node.type)) {
      hasRichContent = true; // table, mediaSingle, codeBlock, panel, expand…
      // Keep whatever text is inside so nothing readable disappears from the text box.
      return (node.content || []).flatMap(child => blockLines(child, prefix));
    }
    if (node.type === 'paragraph' || node.type === 'heading') return [prefix + inlineText(node.content)];
    if (node.type === 'rule') return ['---'];
    if (node.type === 'bulletList') return (node.content || []).flatMap(item => blockLines(item, `${prefix}- `));
    if (node.type === 'orderedList') {
      return (node.content || []).flatMap((item, index) => blockLines(item, `${prefix}${index + 1}. `));
    }
    // listItem / blockquote: their children are blocks; only the first line carries the bullet.
    const lines = (node.content || []).flatMap((child, index) => blockLines(child, index === 0 ? prefix : ''));
    return lines.length > 0 ? lines : [prefix];
  };

  const lines = (adf.content || []).flatMap(node => blockLines(node));
  // A real paragraph that only holds a space (Test Pulse writes one when the description is
  // empty) should not show up as text.
  const text = lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, hasRichContent };
}

/**
 * Converts the plain text typed in Design to an ADF document Jira accepts.
 *
 *   - every line becomes a paragraph; a blank line becomes an empty paragraph, so the spacing
 *     the tester typed is kept;
 *   - a label at the start of a line ("Pre-conditions:", "Test Script:", "Given:"…) is written
 *     in bold, the same way the CSV upload has always done it.
 *
 * @param {string} text
 * @returns {Object} ADF document.
 */
export function plainTextToAdf(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_DESCRIPTION_CHARS).replace(/\s+$/, '');
  const content = [];
  for (const rawLine of clean.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      content.push({ type: 'paragraph' }); // blank line
      continue;
    }
    // "Label: rest" → bold label. Only a short label (at most 40 characters before the colon)
    // counts, so a long sentence that merely contains a colon is left alone.
    const label = line.match(/^([^:\n]{1,40}):(.*)$/);
    if (label && !/^https?$/i.test(label[1].trim())) {
      const parts = [{ type: 'text', text: `${label[1]}:`, marks: [{ type: 'strong' }] }];
      if (label[2]) parts.push({ type: 'text', text: label[2] });
      content.push({ type: 'paragraph', content: parts });
    } else {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    }
  }
  // Jira rejects an empty document, and some projects make the description mandatory.
  if (content.length === 0 || content.every(node => !node.content)) {
    return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
  }
  return { type: 'doc', version: 1, content };
}

// ── Values sent by the edit form ────────────────────────────────────────────────────────────

/** Jira ids of options, priorities and custom fields are short and made of safe characters. */
const isSafeOptionId = (value) => /^[A-Za-z0-9_-]{1,40}$/.test(String(value ?? ''));
const isCustomFieldId = (value) => /^customfield_\d{3,10}$/.test(String(value ?? ''));

/**
 * Builds the `fields` object for Jira from what the edit form changed. Only the fields present
 * in `changes` are included, so saving never touches something the tester did not edit.
 *
 * @param {Object} changes - Changed values:
 *        summary?: string
 *        descriptionText?: string
 *        priorityId?: string                                  ('' = leave Jira's default)
 *        testLevel?/testType?/executionType?: {optionId: string, multiple: boolean}
 *        epicKey?: string                                     ('' = no epic of its own)
 * @param {{testLevel: string, testType: string, executionType: string}} fieldIds - Custom field
 *        ids of the project (from customFieldConfig.js).
 * @returns {{fields: Object, errors: string[]}} `errors` lists what the form sent wrong.
 */
export function buildTestCaseFields(changes, fieldIds) {
  const fields = {};
  const errors = [];
  const input = changes && typeof changes === 'object' ? changes : {};

  if (input.summary !== undefined) {
    const summary = String(input.summary ?? '').replace(/\s+/g, ' ').trim();
    if (!summary) errors.push('El resumen es obligatorio.');
    else if (summary.length > 255) errors.push('El resumen no puede pasar de 255 caracteres.');
    else fields.summary = summary;
  }

  if (input.descriptionText !== undefined) {
    if (String(input.descriptionText ?? '').length > MAX_DESCRIPTION_CHARS) {
      errors.push(`La descripción no puede pasar de ${MAX_DESCRIPTION_CHARS} caracteres.`);
    } else {
      fields.description = plainTextToAdf(input.descriptionText);
    }
  }

  if (input.priorityId !== undefined && input.priorityId !== '') {
    if (isSafeOptionId(input.priorityId)) fields.priority = { id: String(input.priorityId) };
    else errors.push('La prioridad seleccionada no es válida.');
  }

  // The three classification fields are single- or multi-select lists in Jira.
  for (const [name, label] of [['testLevel', 'Nivel de Prueba'], ['testType', 'Tipo de Prueba'], ['executionType', 'Tipo de Ejecución']]) {
    const change = input[name];
    if (change === undefined) continue;
    const fieldId = fieldIds?.[name];
    if (!isCustomFieldId(fieldId)) {
      errors.push(`El campo "${label}" no está configurado en este proyecto.`);
      continue;
    }
    const optionId = change?.optionId;
    if (optionId === '' || optionId === null || optionId === undefined) {
      fields[fieldId] = change?.multiple ? [] : null; // cleared
    } else if (isSafeOptionId(optionId)) {
      fields[fieldId] = change?.multiple ? [{ id: String(optionId) }] : { id: String(optionId) };
    } else {
      errors.push(`El valor de "${label}" no es válido.`);
    }
  }

  // Epic of the Test Case (v4.23.1). In Jira Cloud the epic of an issue is its `parent`.
  if (input.epicKey !== undefined) {
    const epicKey = String(input.epicKey ?? '').trim().toUpperCase();
    if (!epicKey) fields.parent = null;
    else if (/^[A-Z][A-Z0-9_]*-\d+$/.test(epicKey)) fields.parent = { key: epicKey };
    else errors.push('La épica seleccionada no es válida.');
  }

  return { fields, errors };
}

/**
 * Turns the field metadata Jira returns (create or edit metadata) into what the Design screens
 * need to draw their lists: the options of Prioridad, Nivel de Prueba, Tipo de Prueba and Tipo de
 * Ejecución, whether each list accepts several values, and whether it is mandatory.
 *
 * @param {Object} metaFields - Jira metadata indexed by field id (`{ priority: {...}, customfield_1: {...} }`).
 * @param {{testLevel: string, testType: string, executionType: string}} fieldIds
 * @returns {{priority: Object, testLevel: Object, testType: Object, executionType: Object, epic: Object}}
 *          Each entry: { available, required, multiple, options: [{id, label}] }.
 */
export function buildFormOptions(metaFields, fieldIds) {
  const meta = metaFields && typeof metaFields === 'object' ? metaFields : {};
  const describe = (fieldId) => {
    const field = fieldId ? meta[fieldId] : null;
    const options = (Array.isArray(field?.allowedValues) ? field.allowedValues : [])
      .filter(option => option && option.id !== undefined && option.disabled !== true)
      .map(option => ({ id: String(option.id), label: String(option.value || option.name || option.id) }));
    return {
      // "available" = Jira lets this user set the field on this screen.
      available: Boolean(field),
      required: Boolean(field?.required),
      multiple: field?.schema?.type === 'array',
      options
    };
  };
  return {
    priority: describe('priority'),
    testLevel: describe(fieldIds?.testLevel),
    testType: describe(fieldIds?.testType),
    executionType: describe(fieldIds?.executionType),
    // The epic is the `parent` field; it has no list of options in the metadata.
    epic: { available: Boolean(meta.parent), required: false, multiple: false, options: [] }
  };
}
