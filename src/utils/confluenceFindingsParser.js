/**
 * @file confluenceFindingsParser.js
 * @description Reads a Shift-Left "Reporte de hallazgos" written in Confluence and turns it into
 * numbers Test Pulse can show (how many findings, by impact, open vs closed, document maturity).
 *
 * The QA team keeps writing the report in Confluence with its usual template
 * ("Hallazgos documentación BRD / ERF …"). Test Pulse only READS the page, so nobody has to type
 * the totals again. The page arrives in Confluence "storage format", which is XHTML: paragraphs,
 * `<table>` elements and Confluence macros such as the coloured status lozenge.
 *
 * What the parser looks for:
 *   1. General data, written as "Label: value" lines (or two-cell table rows):
 *      Documento analizado, Nombre del documento, Versión, Proyecto / Iniciativa, Analista QA,
 *      Fecha del análisis, Resultado general.
 *   2. The findings table: the first table whose header row has an "ID" column plus a
 *      "Tipo…", "Descripción…" or "Impacto" column. Columns are matched by header text, so their
 *      order does not matter and extra columns are ignored.
 *   3. Document maturity: "madurez del 85%" anywhere in the text; otherwise closed / total.
 *
 * A finding counts as closed when its "Estado" column (recommended) says so. Reports written
 * before that column existed mark a closed finding in the "Tipo de hallazgo" column
 * ("Cerrado"), so that is used as a fallback.
 *
 * This module has no imports: it is plain text processing and is unit-tested in
 * tests/lifecycle.test.js.
 */

// Upper bounds so a huge or malformed page can never produce a huge stored record.
const MAX_FINDINGS = 200;
const MAX_TEXT = 600;

/** Lower-cases, removes accents and collapses spaces: "Sección /  Referencia" → "seccion / referencia". */
const normalize = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Named entities Confluence writes for accented letters and punctuation in Spanish text.
const NAMED_ENTITIES = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iquest: '¿', iexcl: '¡', ordm: 'º', ordf: 'ª', deg: '°',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’'
};

/** Decodes the HTML entities Confluence uses in storage format. */
const decodeEntities = (text) => String(text || '')
  .replace(/&([A-Za-z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&[a-z]+;/gi, ' ');

/**
 * Removes macro parameters that are configuration, not content. A status lozenge is stored as
 * `<ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">CORREGIDO</…>`;
 * only the title is text the reader sees.
 */
const dropMacroConfig = (html) => String(html || '')
  .replace(/<ac:parameter\b(?![^>]*ac:name="title")[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');

/** Converts a fragment of storage-format XHTML to plain text on a single line. */
const cellText = (html) => decodeEntities(
  dropMacroConfig(html)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, ' ')
    .replace(/<[^>]+>/g, '')
).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/** Converts the whole page to text lines; table cells of one row are separated by a tab. */
const pageLines = (html) => decodeEntities(
  dropMacroConfig(html)
    .replace(/<\/t[hd]>/gi, '\t')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/tr>|<\/h[1-6]>|<\/table>/gi, '\n')
    .replace(/<[^>]+>/g, '')
).split('\n').map(line => line.replace(/[  ]+/g, ' ').trim()).filter(Boolean);

/** Splits a `<table>` into rows of plain-text cells. */
const tableRows = (tableHtml) => (tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [])
  .map(row => [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => cellText(m[1])))
  .filter(cells => cells.length > 0);

// Header text (normalized) → the field of a finding it fills.
const COLUMN_MATCHERS = [
  ['id', (h) => h === 'id' || h.startsWith('id ') || h === '#'],
  ['status', (h) => /\b(estado|estatus|status)\b/.test(h)],
  ['type', (h) => h.includes('tipo')],
  ['section', (h) => h.includes('seccion') || h.includes('referencia')],
  ['description', (h) => h.includes('descripcion')],
  ['impact', (h) => h.includes('impacto') || h.includes('severidad')],
  ['suggestion', (h) => h.includes('sugerencia') || h.includes('recomendacion')],
  ['owner', (h) => h.includes('responsable')]
];

/** Maps each header cell of a table to a finding field; returns `{ field: columnIndex }`. */
const mapColumns = (headerCells) => {
  const columns = {};
  headerCells.forEach((cell, index) => {
    const header = normalize(cell);
    const match = COLUMN_MATCHERS.find(([field, test]) => columns[field] === undefined && test(header));
    if (match) columns[match[0]] = index;
  });
  return columns;
};

// Words that mean a finding needs no further action.
// "Aclarado" is the status the team writes in section 9 ("Estado de atención de hallazgos") when
// the document owner has answered the finding, so it also counts as attended.
const CLOSED_PATTERN = /\b(cerrad[oa]s?|corregid[oa]s?|resuelt[oa]s?|atendid[oa]s?|solucionad[oa]s?|aclarad[oa]s?|closed|done|fixed)\b/;

/**
 * Makes finding IDs comparable between tables: "H01", "h-01" and "H 01" are the same finding.
 */
const normalizeFindingId = (id) => normalize(id).replace(/[^a-z0-9]/g, '');

/**
 * Reads the table of section 9, "Estado de atención de hallazgos" (v4.18.1). That table has one
 * row per finding with the columns ID | Estado | Respuesta funcional | Ajuste requerido en
 * documento, and it is where the team records what happened to each finding. It is told apart
 * from the detail table of section 5 because it has "ID" and "Estado" but none of the detail
 * columns (type, description, impact).
 *
 * @param {string[]} tables - Every `<table>` of the page, as storage-format HTML.
 * @returns {Map<string, string>|null} normalized finding ID → status text; null when the page has
 *          no such table.
 */
const readAttentionStatuses = (tables) => {
  for (const table of tables) {
    const rows = tableRows(table);
    if (rows.length < 1) continue;
    const columns = mapColumns(rows[0]);
    const isAttentionTable = columns.id !== undefined && columns.status !== undefined &&
      columns.type === undefined && columns.description === undefined && columns.impact === undefined;
    if (!isAttentionTable) continue;
    const statuses = new Map();
    rows.slice(1).forEach(row => {
      const id = normalizeFindingId(row[columns.id] || '');
      if (id) statuses.set(id, String(row[columns.status] || '').slice(0, 40));
    });
    return statuses;
  }
  return null;
};

/** "alto " → "Alto"; anything unknown or empty → "Sin clasificar". */
const normalizeImpact = (value) => {
  const text = normalize(value);
  if (!text) return 'Sin clasificar';
  if (text.startsWith('crit') || text.startsWith('bloq')) return 'Crítico';
  if (text.startsWith('alt') || text === 'high') return 'Alto';
  if (text.startsWith('med')) return 'Medio';
  if (text.startsWith('baj') || text === 'low') return 'Bajo';
  if (text === 'n/a' || text === 'na' || text === 'no aplica') return 'N/A';
  return 'Sin clasificar';
};

// General-data labels (normalized) → field name in the result.
const GENERAL_LABELS = [
  ['documento analizado', 'documentType'],
  ['nombre del documento', 'documentName'],
  ['version', 'version'],
  ['proyecto / iniciativa', 'initiative'],
  ['proyecto/iniciativa', 'initiative'],
  ['analista qa', 'analyst'],
  ['fecha del analisis', 'analysisDate'],
  ['resultado general', 'overallResult']
];

/** Reads the "Label: value" lines of the report header. */
const readGeneralData = (lines) => {
  const general = {};
  const labelOf = (line) => {
    const head = normalize(line.split(/[:\t]/)[0]);
    return GENERAL_LABELS.find(([label]) => head === label);
  };
  lines.forEach((line, index) => {
    const label = labelOf(line);
    if (!label || general[label[1]]) return;
    let value = line.replace(/^[^:\t]*[:\t]/, '').replace(/\t/g, ' ').trim();
    // The status lozenge of "Resultado general" is usually on the line below its label.
    if (!value) {
      const next = lines[index + 1] || '';
      const nextIsContent = next && !labelOf(next) && !/^\d+\.\s/.test(next) && next.length <= 80;
      if (nextIsContent) value = next.replace(/\t/g, ' ').trim();
    }
    if (value) general[label[1]] = value.slice(0, 300);
  });
  return general;
};

/**
 * Extracts the numeric page ID from a Confluence page link.
 * Accepts `…/wiki/spaces/CU/pages/123456789/Titulo`, `…viewpage.action?pageId=123456789`
 * or the bare ID. Short links (`/wiki/x/AbCd`) do not contain the ID and return null.
 *
 * @param {string} urlOrId
 * @returns {string|null}
 */
export function extractConfluencePageId(urlOrId) {
  const text = String(urlOrId || '').trim();
  if (/^\d{3,20}$/.test(text)) return text;
  const match = text.match(/\/pages\/(?:edit-v2\/|edit\/)?(\d{3,20})(?:[/?#]|$)/) || text.match(/[?&]pageId=(\d{3,20})(?:[&#]|$)/);
  return match ? match[1] : null;
}

/**
 * Parses a findings report page.
 *
 * @param {string} storageHtml - Page body in Confluence storage format.
 * @returns {{
 *   recognized: boolean,          // false when no findings table was found
 *   hasStatusColumn: boolean,     // false → closed findings were inferred from the "Tipo" column
 *   statusSource: 'attention-table'|'findings-table'|'type-column'|null,
 *   general: Object,              // documentType, documentName, version, initiative, analyst, analysisDate, overallResult
 *   findings: Array<Object>,      // id, type, section, impact, owner, status, closed
 *   totals: { total: number, open: number, closed: number, byImpact: Object, openByImpact: Object, byType: Object },
 *   maturityPct: number|null,
 *   maturitySource: 'document'|'calculated'|null
 * }}
 */
export function parseFindingsReport(storageHtml) {
  const html = String(storageHtml || '');
  const lines = pageLines(html);
  const general = readGeneralData(lines);

  // Find the findings table.
  let findings = [];
  let hasStatusColumn = false;
  let recognized = false;
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  // Section 9 ("Estado de atención de hallazgos"), when present, is the source of truth for the
  // status of every finding.
  const attentionStatuses = readAttentionStatuses(tables);
  // Where the status of the findings came from: 'attention-table' (section 9), 'findings-table'
  // (an "Estado" column in the detail table) or 'type-column' (old reports, inferred).
  let statusSource = null;
  for (const table of tables) {
    const rows = tableRows(table);
    if (rows.length < 1) continue;
    const columns = mapColumns(rows[0]);
    const isFindingsTable = columns.id !== undefined &&
      (columns.type !== undefined || columns.description !== undefined || columns.impact !== undefined);
    if (!isFindingsTable) continue;

    recognized = true;
    hasStatusColumn = attentionStatuses !== null || columns.status !== undefined;
    statusSource = attentionStatuses !== null
      ? 'attention-table'
      : (columns.status !== undefined ? 'findings-table' : 'type-column');
    const cell = (row, field) => (columns[field] === undefined ? '' : (row[columns[field]] || ''));
    findings = rows.slice(1)
      .filter(row => cell(row, 'id') || cell(row, 'description'))
      .slice(0, MAX_FINDINGS)
      .map(row => {
        const type = cell(row, 'type');
        // With section 9, a finding that is missing from it (or has an empty status there) has
        // not been attended yet, so it stays open.
        const status = attentionStatuses !== null
          ? (attentionStatuses.get(normalizeFindingId(cell(row, 'id'))) || '')
          : cell(row, 'status');
        const closed = hasStatusColumn
          ? CLOSED_PATTERN.test(normalize(status))
          : CLOSED_PATTERN.test(normalize(type));
        return {
          id: cell(row, 'id').slice(0, 20),
          type: type.slice(0, 60),
          section: cell(row, 'section').slice(0, 160),
          impact: normalizeImpact(cell(row, 'impact')),
          owner: cell(row, 'owner').slice(0, 160),
          status: status.slice(0, 40),
          closed
        };
      });
    break;
  }

  // Totals.
  const count = (list, keyOf) => list.reduce((acc, item) => {
    const key = keyOf(item) || 'Sin clasificar';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const open = findings.filter(f => !f.closed);
  const totals = {
    total: findings.length,
    open: open.length,
    closed: findings.length - open.length,
    byImpact: count(findings, f => f.impact),
    openByImpact: count(open, f => f.impact),
    byType: count(findings, f => f.type),
    // How many findings are in each status, as written in the report ("Aclarado", "Abierto"…).
    // Only meaningful when the report records a status; "Sin estado" groups the empty ones.
    byStatus: hasStatusColumn ? count(findings, f => f.status || 'Sin estado') : {}
  };

  // Maturity: what the document states wins; otherwise closed / total.
  let maturityPct = null;
  let maturitySource = null;
  const stated = lines.join(' ').match(/madurez[^%\d]{0,40}(\d{1,3})\s*%/i);
  if (stated && Number(stated[1]) <= 100) {
    maturityPct = Number(stated[1]);
    maturitySource = 'document';
  } else if (totals.total > 0) {
    maturityPct = Math.round((totals.closed / totals.total) * 100);
    maturitySource = 'calculated';
  }

  return { recognized, hasStatusColumn, statusSource, general, findings, totals, maturityPct, maturitySource };
}
