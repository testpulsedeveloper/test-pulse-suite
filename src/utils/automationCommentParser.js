/**
 * @file automationCommentParser.js
 * @description Reads the execution result that ANY automation tool (Tosca, Playwright, Selenium,
 * Cypress, Mantis, …) posts as a comment on a Test Run issue.
 * Contract: "Integración de herramientas de automatización → Test Pulse".
 *
 * A comment is an automation result when it has EITHER:
 *   - a JSON object with a `testpulse` key (preferred, usually inside a code block:
 *     `{code:json}` in API v2 or an ADF `codeBlock` in API v3), OR
 *   - the marker line `Ejecutado por: Automatización <Herramienta>` (accents and case ignored),
 *     followed by the same human-readable labels Test Pulse writes for manual executions
 *     ("Resultado de Ejecución: …", "Iteración #n [datos] — Estado: …", …).
 *
 * The tool that produced the result comes from the JSON `tool` field, otherwise from the name
 * after "Automatización". Known tools are normalised to one spelling (see AUTOMATION_TOOLS);
 * unknown names are accepted as written so new tools work without a code change.
 *
 * The parser is pure (no Jira calls) so it can be unit-tested with plain objects.
 */

import { normalizeJiraStatus } from './statusAndAdfHelpers.js';

/** Marker used by the first integration (IArvis runs Tosca); still accepted. */
export const AUTOMATION_MARKER = 'Ejecutado por: Automatización IArvis';
/** Generic marker prefix: `Ejecutado por: Automatización <Herramienta>`. */
export const AUTOMATION_MARKER_PREFIX = 'Ejecutado por: Automatización';
/** Tool name used when a result names none. */
export const GENERIC_AUTOMATION_TOOL = 'Automatización';
/** @deprecated kept for older callers: IArvis results without `tool` are Tosca runs. */
export const DEFAULT_AUTOMATION_TOOL = 'Tosca';

/**
 * Canonical tool names and the spellings each one accepts (compared accent/case-insensitive,
 * ignoring spaces, dots, dashes and underscores).
 */
export const AUTOMATION_TOOLS = Object.freeze([
  { name: 'Tosca', aliases: ['tosca', 'tricentis tosca', 'tricentis', 'iarvis', 'automatizacion iarvis'] },
  { name: 'Playwright', aliases: ['playwright', 'pw'] },
  { name: 'Selenium', aliases: ['selenium', 'selenium webdriver', 'webdriver', 'selenium grid'] },
  { name: 'Cypress', aliases: ['cypress'] },
  { name: 'Mantis', aliases: ['mantis', 'mantisbt'] },
  { name: 'Appium', aliases: ['appium'] },
  { name: 'Postman', aliases: ['postman', 'newman'] },
  { name: 'Katalon', aliases: ['katalon', 'katalon studio'] },
  { name: 'Robot Framework', aliases: ['robot', 'robot framework', 'robotframework'] },
  { name: 'JUnit', aliases: ['junit'] },
  { name: 'TestNG', aliases: ['testng'] },
  { name: 'Cucumber', aliases: ['cucumber', 'gherkin'] },
  { name: 'JMeter', aliases: ['jmeter', 'apache jmeter'] },
  { name: 'k6', aliases: ['k6'] },
  { name: 'WebdriverIO', aliases: ['webdriverio', 'wdio'] },
  { name: 'Pytest', aliases: ['pytest', 'py.test'] },
  { name: 'UFT', aliases: ['uft', 'qtp', 'micro focus uft', 'opentext uft'] }
]);

const VALID_RUN_STATUSES = new Set(['Passed', 'Failed', 'Blocked', 'In Progress', 'Not Run']);
const VALID_ITERATION_STATUSES = new Set(['Passed', 'Failed', 'Blocked', 'Not Run']);

/** Lower-case, accent-free, single-spaced copy of a string, for tolerant comparisons. */
const fold = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Same as fold() but also drops spaces and punctuation, to compare tool names. */
const toolKey = (value) => fold(value).replace(/[\s._\-/]+/g, '');

const TOOL_BY_KEY = new Map();
for (const tool of AUTOMATION_TOOLS) {
  TOOL_BY_KEY.set(toolKey(tool.name), tool.name);
  for (const alias of tool.aliases) TOOL_BY_KEY.set(toolKey(alias), tool.name);
}

/**
 * Normalises a tool name: known tools get their canonical spelling, unknown ones are kept
 * (trimmed, max 40 characters). Returns null for empty values.
 *
 * @param {unknown} raw - Tool name as written by the automation.
 * @returns {string|null}
 */
export function normalizeToolName(raw) {
  const text = String(raw ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!text) return null;
  return TOOL_BY_KEY.get(toolKey(text)) || text.slice(0, 40);
}

const FOLDED_MARKER_PREFIX = fold(AUTOMATION_MARKER_PREFIX);

/**
 * Finds the generic marker line and returns the tool written after "Automatización"
 * ('' when the line has no name), or null when there is no marker.
 */
function findMarkerTool(lines) {
  for (const raw of lines) {
    const folded = fold(raw);
    const idx = folded.indexOf(FOLDED_MARKER_PREFIX);
    if (idx === -1) continue;
    // Take the original text after the marker, up to the next known label on the same line.
    const after = String(raw).slice(String(raw).length - (folded.length - idx - FOLDED_MARKER_PREFIX.length));
    return after.split(/\s(?:💬|🔁|📊|comentario:|iteraci[oó]n|resultado de ejecuci[oó]n)/i)[0].trim();
  }
  return null;
}

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
    tool: normalizeToolName(json.tool),
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
    tool: null,
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
  const json = findJsonPayload(codeBlocks, fullText);
  const markerTool = findMarkerTool(lines);
  // Neither the Test Pulse JSON nor the marker line: an ordinary comment.
  if (!json && markerTool === null) return null;

  let parsed;
  if (json) {
    parsed = fromJson(json);
    // An invalid JSON payload falls back to the text, as the contract describes.
    if (parsed.error && markerTool !== null) {
      const textParsed = fromText(lines);
      if (!textParsed.error) parsed = textParsed;
    }
  } else {
    parsed = fromText(lines);
  }
  if (parsed.error) return parsed;
  parsed.tool = parsed.tool || normalizeToolName(markerTool) || GENERIC_AUTOMATION_TOOL;
  return parsed;
}

/**
 * Cheap pre-check used before fetching a comment: does this raw value mention the marker?
 *
 * @param {unknown} raw - Anything (ADF object, string…).
 * @returns {boolean}
 */
export function mentionsAutomationMarker(raw) {
  if (raw === undefined || raw === null) return false;
  const text = fold(typeof raw === 'string' ? raw : JSON.stringify(raw));
  // ADF splits "Ejecutado por: " and "Automatización X" into separate text nodes, so look for
  // the pieces independently; the full parser decides afterwards.
  return text.includes('testpulse') || text.includes('automatizacion');
}
