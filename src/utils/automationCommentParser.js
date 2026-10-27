/**
 * @file automationCommentParser.js
 * @description Reads the execution result that an automation tool (Tosca / IArvis) posts as a
 * comment on a Test Run issue. Contract: "Integración Tosca → Test Pulse: formato de comentario".
 *
 * A comment is an automation result only if it contains the marker
 * `Ejecutado por: Automatización IArvis` (accents and case are ignored). Then:
 *   1. Preferred: a JSON object with a `testpulse` key, usually inside a code block
 *      (`{code:json}` in API v2 or an ADF `codeBlock` in API v3).
 *   2. Fallback: the human-readable text, with the same labels Test Pulse writes for manual
 *      executions ("Resultado de Ejecución: …", "Iteración #n [datos] — Estado: …", …).
 *
 * The parser is pure (no Jira calls) so it can be unit-tested with plain objects.
 */

import { normalizeJiraStatus } from './statusAndAdfHelpers.js';

export const AUTOMATION_MARKER = 'Ejecutado por: Automatización IArvis';
export const DEFAULT_AUTOMATION_TOOL = 'Tosca';

const VALID_RUN_STATUSES = new Set(['Passed', 'Failed', 'Blocked', 'In Progress', 'Not Run']);
const VALID_ITERATION_STATUSES = new Set(['Passed', 'Failed', 'Blocked', 'Not Run']);

/** Lower-case, accent-free, single-spaced copy of a string, for tolerant comparisons. */
const fold = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const FOLDED_MARKER = fold(AUTOMATION_MARKER);

/**
 * Turns a comment body (ADF document, ADF JSON string or plain/wiki text) into text lines
 * plus the raw contents of its code blocks.
 *
 * @param {Object|string} body - Comment body as returned by Jira.
 * @returns {{ lines: string[], codeBlocks: string[] }}
 */
export function extractCommentContent(body) {
  let doc = body;
  if (typeof doc === 'string') {
    const trimmed = doc.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
      try { doc = JSON.parse(trimmed); } catch (_) { doc = body; }
    }
  }
  if (typeof doc === 'string') {
    const codeBlocks = [];
    const text = doc.replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/gi, (_, inner) => {
      codeBlocks.push(inner.trim());
      return '\n';
    });
    return { lines: text.split(/\r?\n/), codeBlocks };
  }

  const lines = [];
  const codeBlocks = [];
  let current = '';
  const flush = () => { lines.push(current); current = ''; };
  const textOf = (node) => (node?.content || []).map(c => (c.type === 'text' ? c.text : (c.type === 'hardBreak' ? '\n' : textOf(c)))).join('');

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'codeBlock':
        flush();
        codeBlocks.push(textOf(node));
        return;
      case 'text':
        current += node.text || '';
        return;
      case 'hardBreak':
        flush();
        return;
      case 'mention':
        current += node.attrs?.text || '';
        return;
      case 'paragraph':
      case 'heading':
        (node.content || []).forEach(walk);
        flush();
        return;
      default:
        (node.content || []).forEach(walk);
    }
  };
  walk(doc);
  flush();
  // Text nodes may embed "\n" (Test Pulse's own comments do): split those too.
  return { lines: lines.flatMap(l => l.split(/\r?\n/)), codeBlocks };
}

/** Normalises a status word; returns null when it is not one Test Pulse understands. */
function toStatus(raw, allowed) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const normalized = normalizeJiraStatus(String(raw).trim());
  return allowed.has(normalized) ? normalized : null;
}

/** Finds the first JSON object carrying the `testpulse` key in code blocks or plain text. */
function findJsonPayload(codeBlocks, fullText) {
  const candidates = [...codeBlocks];
  const start = fullText.indexOf('{');
  const end = fullText.lastIndexOf('}');
  if (start !== -1 && end > start && fullText.includes('"testpulse"')) {
    candidates.push(fullText.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'testpulse' in parsed) return parsed;
    } catch (_) {}
  }
  return null;
}

const toStringList = (value) => (Array.isArray(value) ? value : (value ? [value] : []))
  .map(v => String(v).trim()).filter(Boolean);

function fromJson(json) {
  const status = toStatus(json.status, VALID_RUN_STATUSES);
  if (!status) return { error: `Estado no reconocido en el JSON: "${json.status ?? ''}"` };

  const iterations = [];
  for (const [idx, it] of (Array.isArray(json.iterations) ? json.iterations : []).entries()) {
    const itStatus = toStatus(it?.status, VALID_ITERATION_STATUSES);
    if (!itStatus) return { error: `Estado no reconocido en la iteración #${idx + 1}: "${it?.status ?? ''}"` };
    iterations.push({
      data: it?.data ? String(it.data) : '',
      status: itStatus,
      result: it?.result ? String(it.result) : '',
      evidences: toStringList(it?.evidences)
    });
  }

  return {
    format: 'json',
    status,
    tool: json.tool ? String(json.tool) : DEFAULT_AUTOMATION_TOOL,
    executedAt: json.executedAt ? String(json.executedAt) : null,
    environment: json.environment ? String(json.environment) : null,
    comment: json.comment ? String(json.comment) : '',
    externalId: json.externalId ? String(json.externalId) : null,
    iterations
  };
}

/**
 * Puts every label on its own line. Comments copied from Jira's screen (or written by tools)
 * often lose line breaks, leaving "… — Estado: Passed Comentario / Resultado: … Adjuntos: …"
 * on a single line; splitting before each known label makes both layouts read the same.
 */
function splitLabels(lines) {
  const LABELS = /\s+(?=(?:[-•*]\s*)?(?:iteraci[oó]n\s*#|comentario\s*\/\s*resultado:|adjuntos:|ejecutado por:|ciclo:|(?:💬\s*)?comentario:|(?:📊\s*)?resultado de ejecuci[oó]n:|(?:🔁\s*)?iteraciones\s*\())/gi;
  return lines.flatMap(line => String(line).split(LABELS));
}

function fromText(rawLines) {
  let status = null;
  let comment = '';
  const iterations = [];
  let lastIteration = null;
  const lines = splitLabels(rawLines);

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[\s\-•*]+/, '').trim();
    if (!line) continue;

    let m = line.match(/resultado de ejecuci[oó]n:\s*(.+)$/i);
    if (m) {
      status = toStatus(m[1], VALID_RUN_STATUSES);
      if (!status) return { error: `Estado no reconocido en el texto: "${m[1].trim()}"` };
      continue;
    }

    m = line.match(/iteraci[oó]n\s*#\s*(\d+)\s*(?:\[([^\]]*)\])?\s*[—–-]\s*estado:\s*(.+)$/i);
    if (m) {
      const itStatus = toStatus(m[3], VALID_ITERATION_STATUSES);
      if (!itStatus) return { error: `Estado no reconocido en la iteración #${m[1]}: "${m[3].trim()}"` };
      lastIteration = { data: (m[2] || '').trim(), status: itStatus, result: '', evidences: [] };
      iterations.push(lastIteration);
      continue;
    }

    m = line.match(/comentario\s*\/\s*resultado:\s*(.*)$/i);
    if (m && lastIteration) {
      lastIteration.result = m[1].trim();
      continue;
    }

    m = line.match(/^adjuntos:\s*(.+)$/i);
    if (m && lastIteration) {
      lastIteration.evidences = toStringList(m[1].split(','));
      continue;
    }

    m = line.match(/(?:^|\s)comentario:\s*(.+)$/i);
    if (m && !/resultado:/i.test(line)) {
      comment = m[1].trim();
    }
  }

  if (!status) return { error: 'El texto no trae "Resultado de Ejecución: <estado>"' };
  return {
    format: 'text',
    status,
    tool: DEFAULT_AUTOMATION_TOOL,
    executedAt: null,
    environment: null,
    comment,
    externalId: null,
    iterations
  };
}

/**
 * Parses an automation result comment.
 *
 * @param {Object|string} body - Comment body (ADF or text).
 * @returns {null|{error: string}|{format: 'json'|'text', status: string, tool: string,
 *   executedAt: string|null, environment: string|null, comment: string, externalId: string|null,
 *   iterations: Array<{data: string, status: string, result: string, evidences: string[]}>}}
 *   `null` when the comment is not an automation result (no marker).
 */
export function parseAutomationComment(body) {
  const { lines, codeBlocks } = extractCommentContent(body);
  const fullText = lines.join('\n');
  if (!fold(fullText).includes(FOLDED_MARKER) && !codeBlocks.some(b => fold(b).includes(FOLDED_MARKER))) {
    return null;
  }
  const json = findJsonPayload(codeBlocks, fullText);
  if (json) {
    const parsed = fromJson(json);
    if (!parsed.error) return parsed;
    // An invalid JSON payload falls back to the text, as the contract describes.
    const textParsed = fromText(lines);
    return textParsed.error ? parsed : textParsed;
  }
  return fromText(lines);
}

/**
 * Cheap pre-check used before fetching a comment: does this raw value mention the marker?
 *
 * @param {unknown} raw - Anything (ADF object, string…).
 * @returns {boolean}
 */
export function mentionsAutomationMarker(raw) {
  if (raw === undefined || raw === null) return false;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return fold(text).includes('iarvis');
}
