/**
 * @file wikiPanels.js
 * @description Shows Jira wiki "panel" markup as a real coloured box (v4.23.5).
 *
 * Why this exists
 * ---------------
 * Some Test Cases have a "Precondiciones" custom field whose text is old Jira wiki markup:
 *
 *     {panel:bgColor=#eae6ff}
 *     Datos necesarios para reproducir el error: insumos y condiciones específicas.
 *     {panel}
 *
 * That field uses Jira's plain-text renderer, so Jira returns the markers as literal text and
 * the case panel showed "{panel:bgColor=#eae6ff}" and "{panel}" to the user. This module turns
 * each `{panel…}…{panel}` pair into a box, both for HTML (the case panel) and for ADF (the
 * snapshot frozen into a Test Run). Everything else in the text is left untouched.
 *
 * Wiki syntax reminder: a panel OPENS with `{panel}` or `{panel:param=value|param=value}` and
 * CLOSES with a bare `{panel}`. Markers are therefore paired in order: 1st opens, 2nd closes…
 */

// Any panel marker, with optional parameters after a colon.
const PANEL_MARKER = /\{panel(?::([^}]*))?\}/g;

// Colour used when the markup has no (valid) bgColor.
const DEFAULT_BG = '#F4F5F7';

/**
 * Reads `bgColor` and `title` from the marker parameters ("bgColor=#eae6ff|title=Datos").
 * The colour is accepted ONLY as a hex value, so nothing else can reach a style attribute.
 *
 * @param {string} [params] - Text after "{panel:".
 * @returns {{bgColor: string, title: string}}
 */
export function parsePanelParams(params) {
  const out = { bgColor: DEFAULT_BG, title: '' };
  for (const part of String(params || '').split('|')) {
    const [rawName, ...rest] = part.split('=');
    const name = String(rawName || '').trim().toLowerCase();
    const value = rest.join('=').trim();
    if (name === 'bgcolor' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) out.bgColor = value;
    if (name === 'title' && value) out.title = value;
  }
  return out;
}

/**
 * Pairs the panel markers of a text: returns [{open, close}] with the regex matches, or []
 * when there is no complete pair. An unmatched last opener is left as it is.
 *
 * @param {string} text
 * @returns {Array<{open: RegExpExecArray, close: RegExpExecArray}>}
 */
function pairMarkers(text) {
  const markers = Array.from(String(text).matchAll(PANEL_MARKER));
  const pairs = [];
  for (let i = 0; i + 1 < markers.length; i += 2) {
    pairs.push({ open: markers[i], close: markers[i + 1] });
  }
  return pairs;
}

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Converts panel markers inside an HTML string (Jira's rendered HTML or HTML built by the app).
 * Line breaks and empty paragraphs right next to a marker are dropped so the box has no blank
 * first or last line. The resulting HTML is still sanitized by the page before display.
 *
 * @param {string} html
 * @returns {string} HTML with `<div class="tp-wiki-panel">` boxes, or the input unchanged.
 */
export function wikiPanelsToHtml(html) {
  if (typeof html !== 'string' || !html.includes('{panel')) return html;
  const pairs = pairMarkers(html);
  if (pairs.length === 0) return html;

  let out = '';
  let cursor = 0;
  for (const { open, close } of pairs) {
    const { bgColor, title } = parsePanelParams(open[1]);
    const inner = html.slice(open.index + open[0].length, close.index)
      .replace(/^\s*(<br\s*\/?>\s*)+/i, '')
      .replace(/(\s*<br\s*\/?>)+\s*$/i, '');
    const titleHtml = title ? `<strong>${escHtml(title)}</strong><br/>` : '';
    out += html.slice(cursor, open.index);
    out += `<div class="tp-wiki-panel" style="background-color:${bgColor};border-radius:4px;padding:8px 12px;margin:6px 0;">${titleHtml}${inner}</div>`;
    cursor = close.index + close[0].length;
  }
  out += html.slice(cursor);
  // Jira wraps each line in <p>: remove the empty paragraphs the markers leave behind.
  return out.replace(/<p>\s*<\/p>/gi, '');
}

/**
 * Converts plain text (a plain-text custom field) to ADF block nodes, turning each panel into
 * an ADF `panel` node. Lines outside panels become paragraphs, as before.
 *
 * @param {string} text
 * @returns {Object[]} ADF block nodes ([] for empty text).
 */
export function plainTextToAdfWithPanels(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const toParagraphs = (chunk) => chunk
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter((line, i, arr) => line || (i > 0 && i < arr.length - 1))
    .map(line => line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph', content: [] });

  const pairs = pairMarkers(t);
  if (pairs.length === 0) return toParagraphs(t);

  const nodes = [];
  let cursor = 0;
  for (const { open, close } of pairs) {
    nodes.push(...toParagraphs(t.slice(cursor, open.index)));
    const { title } = parsePanelParams(open[1]);
    const inner = toParagraphs(t.slice(open.index + open[0].length, close.index));
    if (title) inner.unshift({ type: 'paragraph', content: [{ type: 'text', text: title, marks: [{ type: 'strong' }] }] });
    if (inner.length > 0) nodes.push({ type: 'panel', attrs: { panelType: 'info' }, content: inner });
    cursor = close.index + close[0].length;
  }
  nodes.push(...toParagraphs(t.slice(cursor)));
  return nodes;
}
