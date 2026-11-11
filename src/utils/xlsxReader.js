/**
 * @file xlsxReader.js
 * @description Minimal reader for Excel workbooks (.xlsx), used to read the Test Plan attached to
 * a Jira issue (v4.20.0).
 *
 * An .xlsx file is a ZIP archive with XML files inside:
 *   xl/workbook.xml              → the list of sheets (name + relationship id)
 *   xl/_rels/workbook.xml.rels   → relationship id → path of each sheet's XML
 *   xl/sharedStrings.xml         → every distinct text of the workbook; cells point to it by index
 *   xl/worksheets/sheetN.xml     → the cells of one sheet
 *
 * Only what Test Pulse needs is implemented: the TEXT of the cells. Formats, formulas, images
 * and charts are ignored. No npm package is used: the ZIP container is read with Node's built-in
 * `zlib`, which keeps the app free of extra dependencies.
 *
 * Safety limits (the file comes from a Jira attachment, so it is not trusted):
 *   - each XML file may expand to at most MAX_ENTRY_BYTES;
 *   - at most MAX_SHEETS sheets and MAX_ROWS rows per sheet are read.
 */

import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY_BYTES = 12 * 1024 * 1024; // 12 MB of XML per file inside the ZIP
const MAX_SHEETS = 12;
const MAX_ROWS = 1500;
const MAX_COLUMNS = 40;
const MAX_CELL_CHARS = 2000;

/** Decodes the five XML entities and numeric character references. */
const decodeXml = (text) => String(text || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

/** Reads the attributes of an XML start tag into an object: `r="B4" t="s"` → { r: 'B4', t: 's' }. */
const readAttributes = (tagText) => {
  const attributes = {};
  for (const match of String(tagText || '').matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
};

/** "B" → 1, "AA" → 26 (zero-based column index from the letters of a cell reference). */
const columnIndex = (cellRef) => {
  const letters = String(cellRef || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
};

/**
 * Lists the files of a ZIP archive by reading its "central directory" (the index stored at the
 * end of the file).
 *
 * @param {Buffer} buffer - The whole .xlsx file.
 * @returns {Map<string, {method: number, compressedSize: number, size: number, offset: number}>}
 */
function readZipDirectory(buffer) {
  // The "end of central directory" record is in the last 64 KB and starts with PK\x05\x06.
  const start = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const entryCount = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);

  const entries = new Map();
  for (let i = 0; i < entryCount && position + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);
    entries.set(name, {
      method: buffer.readUInt16LE(position + 10),
      compressedSize: buffer.readUInt32LE(position + 20),
      size: buffer.readUInt32LE(position + 24),
      offset: buffer.readUInt32LE(position + 42)
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Returns one file of the ZIP as text, or '' when the archive does not contain it. */
function readZipText(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) return '';
  if (entry.size > MAX_ENTRY_BYTES) throw new Error('El Excel es demasiado grande para leerlo.');
  // The data follows the "local header", whose own name/extra lengths can differ from the index.
  const header = entry.offset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== 0x04034b50) {
    throw new Error('El archivo Excel está dañado.');
  }
  const dataStart = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');           // stored without compression
  if (entry.method === 8) {                                         // "deflate"
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString('utf8');
  }
  throw new Error('El Excel usa un tipo de compresión no soportado.');
}

/** Text of a string item: the `<t>` pieces joined, ignoring phonetic hints (`<rPh>`). */
const stringItemText = (xml) => decodeXml(
  [...String(xml || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map(match => match[1]).join('')
);

/**
 * Reads an .xlsx file into plain rows of text.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} file - Content of the .xlsx file.
 * @returns {{sheets: Array<{name: string, rows: string[][]}>}} `rows[r][c]` is the text of the
 *          cell at row r+1, column c (0 = A). Empty cells are ''. Numbers and dates are returned
 *          as Excel stores them (a date is a serial number such as "46174").
 */
export function readXlsx(file) {
  const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
  const entries = readZipDirectory(buffer);

  // 1. Shared strings.
  const sharedStrings = [...readZipText(buffer, entries, 'xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map(match => stringItemText(match[1]));

  // 2. Sheets and where their XML lives.
  const targets = {};
  for (const match of readZipText(buffer, entries, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attributes = readAttributes(match[1]);
    if (attributes.Id && attributes.Target) targets[attributes.Id] = attributes.Target;
  }
  const sheets = [];
  for (const match of readZipText(buffer, entries, 'xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    if (sheets.length >= MAX_SHEETS) break;
    const attributes = readAttributes(match[1]);
    const target = String(targets[attributes['r:id']] || '').replace(/^\//, '');
    if (!target) continue;
    const path = target.startsWith('xl/') ? target : `xl/${target}`;

    // 3. Cells of the sheet.
    const rows = [];
    const xml = readZipText(buffer, entries, path);
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNumber = Number(readAttributes(rowMatch[1]).r);
      if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
      if (rowNumber > MAX_ROWS) break;
      const cells = [];
      for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = readAttributes(cellMatch[1]);
        const column = columnIndex(attributes.r);
        if (column < 0 || column >= MAX_COLUMNS) continue;
        const body = cellMatch[2] || '';
        const value = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let text = '';
        if (attributes.t === 's') text = sharedStrings[Number(value)] || '';
        else if (attributes.t === 'inlineStr') text = stringItemText(body);
        else text = decodeXml(value || '');
        text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_CHARS);
        if (text) cells[column] = text;
      }
      // Fill the gaps so every position of the row is a string.
      rows[rowNumber - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] || '');
    }
    sheets.push({
      name: attributes.name || `Hoja ${sheets.length + 1}`,
      rows: Array.from({ length: rows.length }, (_, i) => rows[i] || [])
    });
  }
  return { sheets };
}
