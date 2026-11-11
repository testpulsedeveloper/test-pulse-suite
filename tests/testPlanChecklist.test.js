/**
 * @file testPlanChecklist.test.js
 * @description v4.20.0: the Test Plan workbook (Excel attached in Jira) is read without external
 * packages and checked against the 17 standard elements of a test plan.
 *
 * The workbook built here has the same layout as the real template
 * "TI-SE TPL Plan de Pruebas" (sheets Estrategia, Recursos, Datos o Insumos, Registro de riesgos
 * and Planeación), with the same kind of gaps a real plan usually has. All names and values are made up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { readXlsx } from '../src/utils/xlsxReader.js';
import { evaluateTestPlan } from '../src/utils/testPlanChecklist.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');

/** Builds a sheet from `{ 'C9': 'text' }` so the test reads like the spreadsheet. */
const sheet = (name, cells) => {
  const rows = [];
  for (const [ref, value] of Object.entries(cells)) {
    const column = ref.replace(/[0-9]/g, '').charCodeAt(0) - 65;
    const row = Number(ref.replace(/[A-Z]/g, '')) - 1;
    rows[row] = rows[row] || [];
    rows[row][column] = value;
  }
  return { name, rows: Array.from({ length: rows.length }, (_, r) => Array.from({ length: (rows[r] || []).length }, (_, c) => (rows[r] || [])[c] || '')) };
};

const LONG = 'Fases: Unitarias, Integración SIT - Código entregado y revisado. Integración continua sin errores críticos.';

const realisticWorkbook = () => ({ sheets: [
  sheet('1. Estrategia', {
    B4: 'PROYECTO DEMO', B5: 'PERSONA UNO',
    C8: 'Aprobadores', I8: 'Ambiente',
    C9: 'Aprobado por:', D9: 'Rol:', E9: 'Fecha:', I9: 'Ambiente', J9: 'Aplica',
    C10: 'PERSONA UNO', I10: 'Sandbox', J10: 'SI',
    C11: 'PERSONA DOS', I11: 'QA', J11: 'SI',
    I12: 'Producción', J12: 'No',
    C15: 'Control de Cambios',
    C16: 'Autor', D16: 'Descripción del cambio', E16: 'Fecha:', F16: 'Versión', I16: 'Periodo',
    C17: 'PERSONA TRES', D17: 'Llenado de formato', E17: '46184.0', F17: '1.0', J17: 'Inicio', K17: 'Fin',
    I20: 'Ciclos', C21: 'Nivel y Tipo de Pruebas', I21: 'Plataforma', J21: 'Ciclos',
    C24: 'Nivel', D24: 'Funcional', E24: 'Regresión', F24: 'Responsable', G24: 'Ambiente',
    C25: 'Unitarias', D25: 'SI', E25: 'SI', F25: 'DEV', G25: 'DEV',
    C26: 'UAT', D26: 'SI', E26: 'SI', F26: 'FUNCIONAL', G26: 'PreProd',
    C37: 'Alcance General', C39: 'Implementación de la primera tienda piloto del proyecto demo',
    C44: 'Feature Probado', C46: 'Este debe definir el alcance a nivel módulo, proceso, proyecto',
    C54: 'Criterios de Aceptación', C56: LONG,
    C72: 'Criterios de inicio o reanudación', C74: LONG,
    C89: 'Criterios de Suspensión', C91: LONG
  }),
  sheet('2. Recursos', { A3: 'Recursos', A5: 'Responsable', B5: 'Rol', C5: 'Área', A6: 'Persona Cuatro', B6: 'PMO', A7: 'Persona Tres', B7: 'QA POS' }),
  sheet('3. Datos o Insumos', { A3: 'Insumos', A5: 'Tipo Insumo', B5: 'Responsable', C5: 'Cantidad', A6: 'Tarjetas internas', B6: 'Persona Cinco', C6: '20.0', A7: 'SKU', A8: 'Ordenes' }),
  sheet('4. Registro de riesgos', { A3: 'Riesgos', A5: '#', B5: 'Descripción', C5: 'Responsable', D5: 'Acción', A6: '1.0', B6: 'Convivencia de ambientes', D6: 'Identificar componentes', A7: '3.0', B7: 'Sistemas legados', C7: 'Persona Seis', D7: 'Identificar ambientes' }),
  sheet('5. Planeación', {
    B1: 'PLAN DE PRUEBAS', B3: 'TÍTULO DEL PROYECTO', D3: 'PROYECTO DEMO', B4: 'RESPONSABLE DEL PROYECTO', D4: 'PERSONA UNO',
    B6: 'NÚMERO EDT', C6: 'TÍTULO DE LA TAREA', D6: 'RESPONSABLE DE LA TAREA', E6: 'FECHA DE INICIO', F6: 'FECHA DE ENTREGA',
    C7: 'PLANEACIÓN', E7: '46174.0', F7: '46255.0', C8: 'Definición de Estrategia', F8: '46188.0', C9: 'Entrega de insumos', F9: 'TBD'
  })
] });

const byNumber = (result) => Object.fromEntries(result.elements.map(e => [e.number, e]));

test('the real plan layout gives the expected result for each of the 17 elements', () => {
  const result = evaluateTestPlan(realisticWorkbook(), { epicCount: 0, defectsUrl: '' });
  assert.equal(result.recognized, true);
  assert.equal(result.elements.length, 17);
  const e = byNumber(result);

  assert.equal(e[1].status, 'complete');
  assert.equal(e[2].status, 'partial');   // approvers without role and date
  assert.equal(e[3].status, 'complete');
  assert.equal(e[4].status, 'partial');   // "Feature probado" still has the template instructions
  assert.match(e[4].detail, /plantilla/);
  for (const n of [5, 6, 7, 8, 9, 10, 13, 17]) assert.equal(e[n].status, 'complete', `element ${n}`);
  assert.equal(e[12].status, 'partial');  // one risk without owner

  // Due in later phases: not counted against the plan while incomplete.
  assert.equal(e[11].status, 'partial');
  assert.equal(e[11].deferred, true);
  assert.equal(e[11].duePhase, 'design');
  assert.equal(e[14].status, 'missing');
  assert.equal(e[14].deferred, true);
  assert.equal(e[14].duePhase, 'build');
  assert.equal(e[15].deferred, true);

  // Element 16 belongs to the plan phase, so a missing link does count.
  assert.equal(e[16].status, 'missing');
  assert.equal(e[16].deferred, false);

  assert.deepEqual(result.totals, { total: 17, complete: 10, partial: 3, missing: 1, deferred: 3 });
  assert.equal(result.compliancePct, 71); // 10 complete of 14 due now
});

test('epics in Jira and the Confluence link cover elements 15 and 16', () => {
  const result = evaluateTestPlan(realisticWorkbook(), { epicCount: 2, defectsUrl: 'https://x.atlassian.net/wiki/spaces/QA/pages/1' });
  const e = byNumber(result);
  assert.equal(e[15].status, 'complete');
  assert.equal(e[15].deferred, false);
  assert.equal(e[15].source, 'jira');
  assert.equal(e[16].status, 'complete');
  assert.equal(e[16].source, 'confluence');
  assert.equal(result.totals.deferred, 2);
});

test('filling period and cycles completes element 14', () => {
  const workbook = realisticWorkbook();
  const strategy = workbook.sheets[0];
  strategy.rows[17] = strategy.rows[17] || [];
  strategy.rows[17][9] = '46174.0';   // J18: start
  strategy.rows[17][10] = '46416.0';  // K18: end
  strategy.rows[21] = [];
  strategy.rows[21][8] = 'POS Enactor'; // I22
  strategy.rows[21][9] = '3';           // J22
  for (const row of strategy.rows) for (let c = 0; c < row.length; c++) row[c] = row[c] || '';
  const e = byNumber(evaluateTestPlan(workbook));
  assert.equal(e[14].status, 'complete');
  assert.equal(e[14].deferred, false);
});

test('a workbook that is not the template is not recognized and nothing breaks', () => {
  const result = evaluateTestPlan({ sheets: [sheet('Hoja1', { A1: 'hola' })] });
  assert.equal(result.recognized, false);
  assert.equal(result.elements.length, 17);
  assert.equal(evaluateTestPlan(null).recognized, false);
  assert.equal(evaluateTestPlan({}).elements.filter(x => x.status === 'complete').length, 1); // only 17 (Test Pulse)
});

// ── xlsx reader ─────────────────────────────────────────────────────────────────────────────

/** Builds a minimal ZIP archive (deflate) from `{ path: text }`, enough to be a valid .xlsx. */
const zip = (files) => {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
};

test('readXlsx reads shared strings, numbers, inline strings and cell positions', () => {
  const file = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="1. Estrategia" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Aprobado por:</t></si><si><r><t>Criterios </t></r><r><t>de Aceptaci&#243;n &amp; salida</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="2"><c r="C2" t="s"><v>0</v></c><c r="E2"><v>46184.0</v></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>  en   l&#237;nea </t></is></c><c r="B4" s="3"/><c r="C4" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>'
  });
  const { sheets } = readXlsx(file);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, '1. Estrategia');
  assert.deepEqual(sheets[0].rows[0], []);
  assert.deepEqual(sheets[0].rows[1], ['', '', 'Aprobado por:', '', '46184.0']);
  assert.deepEqual(sheets[0].rows[3], ['en línea', '', 'Criterios de Aceptación & salida']);
});

test('readXlsx rejects a file that is not a ZIP archive', () => {
  assert.throws(() => readXlsx(Buffer.from('esto no es un excel, es texto plano de prueba')), /Excel/);
});

test('the Test Plan deliverable is wired in the resolver and the view', () => {
  const resolvers = read('src/resolvers/lifecycleResolvers.js');
  assert.match(resolvers, /readTestPlanReport\(deliverable, initiative\)/);
  assert.match(resolvers, /api\.asUser\(\)\.requestJira\(route`\/rest\/api\/3\/issue\/\$\{deliverable\.issueKey\}\?fields=attachment`/);
  assert.match(resolvers, /MAX_TEST_PLAN_BYTES/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /<TestPlanSummary report=\{deliverable\.report\} \/>/);
  assert.match(view, /kind: isFindings \? 'findings' : \(isTestPlan \? 'testplan' : 'link'\)/);
});
