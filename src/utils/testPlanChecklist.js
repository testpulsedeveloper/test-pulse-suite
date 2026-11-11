/**
 * @file testPlanChecklist.js
 * @description Checks a Test Plan against the 17 elements of a standard test plan (v4.20.0).
 *
 * The list follows the usual structure of a test plan (ISO/IEC/IEEE 29119-3, successor of
 * IEEE 829) and was agreed with the QA lead. Each element ends up as:
 *   - 'complete' → the section exists and has real content            (shown as "Cumple")
 *   - 'partial'  → the section exists but has incomplete rows or still
 *                  contains the instructions of the template          (shown as "Parcial")
 *   - 'missing'  → the section is empty or was not found              (shown as "Falta")
 *
 * Not every element has to be ready when the plan is first delivered. `duePhase` says in which
 * phase of the lifecycle an element must be covered:
 *   - 11 "Datos e insumos"      → Diseñar  (it is completed during design)
 *   - 14 "Periodo y ciclos"     → Construir (preparation)
 *   - 15 "Entregables de prueba"→ Construir (matrices, stories and epics created in Jira)
 * An element that is not complete yet but is due in a LATER phase than "Planear" is reported as
 * "deferred": it is not counted against the plan.
 *
 * Where each element is read from (`source`):
 *   - 'excel'      → the Test Plan workbook (template "TI-SE TPL Plan de Pruebas")
 *   - 'jira'       → 15: the epics linked to the initiative
 *   - 'testpulse'  → 14: the period and the cycles also live in Test Pulse (schedule of the Test
 *                    Plan and the cycles linked to it); when a Test Pulse plan is captured on the
 *                    deliverable it is used, and the Excel is only the fallback (v4.20.1)
 *   - 'confluence' → 16: the link to the defect-management page, captured on the deliverable
 *   - 'testpulse'  → 17: metrics and reports are the Reports module of Test Pulse itself
 *
 * This file has no imports and never calls Jira, so it can be unit-tested with plain Node.
 */

// ── Text helpers ────────────────────────────────────────────────────────────────────────────

/** Lower case, no accents, single spaces: "Descripción " → "descripcion". */
const norm = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[:*]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Text of a cell, '' when the row or the cell does not exist. */
const cell = (sheet, r, c) => String(sheet?.rows?.[r]?.[c] ?? '').trim();

/**
 * The template ships with instructions inside some cells ("Este debe definir el alcance…").
 * A cell that still has them was not filled in.
 */
const isTemplateText = (value) => /^(este debe|esta seccion|aqui se|describir |describe |indicar |indica |ejemplo|n\/a$|tbd$|por definir)/.test(norm(value));

/** Finds the first cell of a sheet whose normalized text passes `test`. */
const findCell = (sheet, test) => {
  const rows = sheet?.rows || [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] && test(norm(rows[r][c]), r, c)) return { r, c };
    }
  }
  return null;
};

/** Column of the header cell, in row `r`, whose text passes `test` (or -1). */
const headerColumn = (sheet, r, test) => (sheet?.rows?.[r] || []).findIndex(value => value && test(norm(value)));

/**
 * Reads the rows of a table that starts right below a header row. The table ends at the first
 * row whose key column is empty (tables in the template are separated by blank rows).
 *
 * @param {Object} sheet
 * @param {number} headerRow - Row index of the header.
 * @param {number} keyColumn - Column that every real row fills (name, description…).
 * @param {number} [maxRows=200]
 * @returns {number[]} Row indexes of the table body.
 */
const tableBody = (sheet, headerRow, keyColumn, maxRows = 200) => {
  const body = [];
  for (let r = headerRow + 1; r < (sheet?.rows?.length || 0) && body.length < maxRows; r++) {
    if (!cell(sheet, r, keyColumn)) break;
    body.push(r);
  }
  return body;
};

/** Finds a sheet by a word of its name ("estrategia", "recursos"…). */
const findSheet = (workbook, ...words) =>
  (workbook?.sheets || []).find(sheet => words.some(word => norm(sheet.name).includes(word))) || null;

// Titles of the sections of the "Estrategia" sheet. Used to know where a text block ends.
const SECTION_LABELS = [
  'aprobadores', 'control de cambios', 'nivel y tipo de pruebas', 'alcance general', 'feature probado',
  'criterios de aceptacion', 'criterios de inicio o reanudacion', 'criterios de suspension'
];

/**
 * Text written under a section title: the first non-empty cell below it, in the same column,
 * before the next section title (looking at most 15 rows down).
 */
const textUnder = (sheet, label) => {
  const at = findCell(sheet, text => text === label);
  if (!at) return null;
  for (let r = at.r + 1; r <= at.r + 15; r++) {
    const value = cell(sheet, r, at.c);
    if (!value) continue;
    if (SECTION_LABELS.includes(norm(value))) return '';
    return value;
  }
  return '';
};

// ── Result builders ─────────────────────────────────────────────────────────────────────────

const complete = (detail) => ({ status: 'complete', detail });
const partial = (detail) => ({ status: 'partial', detail });
const missing = (detail) => ({ status: 'missing', detail });

/** "3 de 5" style helper for table sections: all rows full → complete, some → partial. */
const byFilledRows = (total, full, noun, lacking) => {
  if (total === 0) return missing(`No hay ${noun} capturados.`);
  if (full === total) return complete(`${total} ${noun}, todos completos.`);
  return partial(`${total} ${noun}; ${total - full} sin ${lacking}.`);
};

/** A free-text section: real text → complete, template instructions → partial, nothing → missing. */
const byText = (value, name) => {
  if (value === null) return missing(`No se encontró la sección "${name}".`);
  if (!value) return missing(`La sección "${name}" está vacía.`);
  if (isTemplateText(value)) return partial(`"${name}" conserva el texto de la plantilla.`);
  if (value.length < 20) return partial(`"${name}" tiene muy poco contenido.`);
  return complete(`"${name}" definido.`);
};

// ── The 17 checks ───────────────────────────────────────────────────────────────────────────

function checkIdentification(strategy, planning) {
  // The planning sheet labels both values; the strategy sheet only shows them at the top.
  const valueRightOf = (label) => {
    const at = findCell(planning, text => text === label);
    if (!at) return '';
    return (planning.rows[at.r] || []).slice(at.c + 1).find(value => value) || '';
  };
  let title = valueRightOf('titulo del proyecto');
  let owner = valueRightOf('responsable del proyecto');
  if (!title || !owner) {
    // Fallback: the first two texts of the strategy sheet are the project and its owner.
    const top = (strategy?.rows || []).slice(0, 8).flat().filter(Boolean);
    title = title || top[0] || '';
    owner = owner || top[1] || '';
  }
  if (title && owner) return complete(`${title} · Responsable: ${owner}`);
  if (title || owner) return partial(title ? 'Falta el responsable del proyecto.' : 'Falta el título del proyecto.');
  return missing('No se encontró el título ni el responsable del proyecto.');
}

function checkApprovers(strategy) {
  const at = findCell(strategy, text => text.startsWith('aprobado por'));
  if (!at) return missing('No se encontró la tabla de aprobadores.');
  const roleCol = headerColumn(strategy, at.r, text => text === 'rol');
  const dateCol = headerColumn(strategy, at.r, text => text === 'fecha');
  const rows = tableBody(strategy, at.r, at.c).filter(r => norm(cell(strategy, r, at.c)) !== 'control de cambios');
  const full = rows.filter(r => cell(strategy, r, roleCol) && cell(strategy, r, dateCol)).length;
  return byFilledRows(rows.length, full, 'aprobadores', 'rol o fecha de aprobación');
}

function checkChangeLog(strategy) {
  const at = findCell(strategy, text => text === 'autor');
  if (!at) return missing('No se encontró el control de cambios.');
  const descCol = headerColumn(strategy, at.r, text => text.startsWith('descripcion'));
  const versionCol = headerColumn(strategy, at.r, text => text === 'version');
  const rows = tableBody(strategy, at.r, at.c);
  const full = rows.filter(r => cell(strategy, r, descCol) && cell(strategy, r, versionCol)).length;
  return byFilledRows(rows.length, full, 'registros de cambio', 'descripción o versión');
}

function checkScope(strategy) {
  const general = byText(textUnder(strategy, 'alcance general'), 'Alcance general');
  const features = byText(textUnder(strategy, 'feature probado'), 'Feature probado');
  if (general.status === 'complete' && features.status === 'complete') return complete('Alcance general y features a probar definidos.');
  if (general.status === 'missing' && features.status === 'missing') return missing('No hay alcance definido.');
  return partial([general, features].filter(item => item.status !== 'complete').map(item => item.detail).join(' '));
}

function checkLevels(strategy) {
  const at = findCell(strategy, (text, r) => text === 'nivel' && headerColumn(strategy, r, t => t === 'funcional') >= 0);
  if (!at) return missing('No se encontró la tabla de niveles y tipos de prueba.');
  const ownerCol = headerColumn(strategy, at.r, text => text === 'responsable');
  const envCol = headerColumn(strategy, at.r, text => text === 'ambiente');
  const rows = tableBody(strategy, at.r, at.c);
  const full = rows.filter(r => cell(strategy, r, ownerCol) && cell(strategy, r, envCol)).length;
  return byFilledRows(rows.length, full, 'niveles de prueba', 'responsable o ambiente');
}

function checkEnvironments(strategy) {
  const at = findCell(strategy, (text, r, c) => text === 'ambiente' && norm(cell(strategy, r, c + 1)) === 'aplica');
  if (!at) return missing('No se encontró la tabla de ambientes.');
  const rows = tableBody(strategy, at.r, at.c);
  const full = rows.filter(r => cell(strategy, r, at.c + 1)).length;
  return byFilledRows(rows.length, full, 'ambientes', 'indicar si aplica');
}

function checkResources(resources) {
  const at = findCell(resources, (text, r) => text === 'responsable' && headerColumn(resources, r, t => t === 'rol') >= 0);
  if (!at) return missing('No se encontró la hoja o la tabla de recursos.');
  const roleCol = headerColumn(resources, at.r, text => text === 'rol');
  const rows = tableBody(resources, at.r, at.c);
  const full = rows.filter(r => cell(resources, r, roleCol)).length;
  return byFilledRows(rows.length, full, 'recursos', 'rol');
}

function checkInputs(inputs) {
  const at = findCell(inputs, text => text.startsWith('tipo insumo') || text === 'insumo');
  if (!at) return missing('No se encontró la hoja o la tabla de datos e insumos.');
  const ownerCol = headerColumn(inputs, at.r, text => text === 'responsable');
  const amountCol = headerColumn(inputs, at.r, text => text === 'cantidad');
  const rows = tableBody(inputs, at.r, at.c);
  const full = rows.filter(r => cell(inputs, r, ownerCol) && cell(inputs, r, amountCol)).length;
  return byFilledRows(rows.length, full, 'insumos', 'responsable o cantidad');
}

function checkRisks(risks) {
  const at = findCell(risks, (text, r) => text.startsWith('descripcion') && headerColumn(risks, r, t => t === 'accion') >= 0);
  if (!at) return missing('No se encontró la hoja o la tabla de riesgos.');
  const ownerCol = headerColumn(risks, at.r, text => text === 'responsable');
  const actionCol = headerColumn(risks, at.r, text => text === 'accion');
  const rows = tableBody(risks, at.r, at.c);
  const full = rows.filter(r => cell(risks, r, ownerCol) && cell(risks, r, actionCol)).length;
  return byFilledRows(rows.length, full, 'riesgos', 'responsable o acción');
}

function checkSchedule(planning) {
  const at = findCell(planning, text => text.startsWith('titulo de la tarea'));
  if (!at) return missing('No se encontró la hoja de planeación con las tareas.');
  const dueCol = headerColumn(planning, at.r, text => text.startsWith('fecha de entrega'));
  let tasks = 0;
  let dated = 0;
  for (let r = at.r + 1; r < planning.rows.length; r++) {
    if (!cell(planning, r, at.c)) continue;
    tasks++;
    // A real date is stored by Excel as a number; "TBD" or empty is not a date.
    if (/^\d+(\.\d+)?$/.test(cell(planning, r, dueCol))) dated++;
  }
  if (tasks === 0) return missing('La hoja de planeación no tiene tareas.');
  if (dated === 0) return partial(`${tasks} tareas, ninguna con fecha de entrega.`);
  return complete(`${tasks} tareas, ${dated} con fecha de entrega.`);
}

function checkPeriodAndCycles(strategy) {
  // Period: a "Periodo" title with "Inicio" and "Fin" headers; the dates go right below them.
  let hasPeriod = false;
  const start = findCell(strategy, (text, r, c) => text === 'inicio' && norm(cell(strategy, r, c + 1)) === 'fin');
  if (start) {
    for (let r = start.r + 1; r <= start.r + 3 && !hasPeriod; r++) {
      hasPeriod = Boolean(cell(strategy, r, start.c) && cell(strategy, r, start.c + 1));
    }
  }
  // Cycles: a "Plataforma | Ciclos" header with one row per platform.
  let cycleRows = 0;
  const cycles = findCell(strategy, (text, r, c) => text === 'plataforma' && norm(cell(strategy, r, c + 1)) === 'ciclos');
  if (cycles) cycleRows = tableBody(strategy, cycles.r, cycles.c, 30).filter(r => cell(strategy, r, cycles.c + 1)).length;

  if (hasPeriod && cycleRows > 0) return complete(`Periodo definido y ${cycleRows} plataforma(s) con ciclos.`);
  if (hasPeriod) return partial('Hay periodo, pero no se definieron los ciclos por plataforma.');
  if (cycleRows > 0) return partial('Hay ciclos por plataforma, pero falta el periodo (inicio y fin).');
  return missing('No se han definido el periodo ni los ciclos.');
}

/**
 * Element 14 from Test Pulse (v4.20.1): the period is the schedule of the Test Plan (start and
 * end dates set in Planning) and the cycles are the Test Cycles linked to that plan.
 *
 * @param {{key: string, startDate: string, endDate: string, cycles: number, error?: string}} plan
 */
function checkPeriodAndCyclesInTestPulse(plan) {
  if (plan.error) return missing(plan.error);
  const hasPeriod = Boolean(plan.startDate && plan.endDate);
  const cycles = Math.max(0, Number(plan.cycles) || 0);
  const period = hasPeriod ? `periodo del ${plan.startDate} al ${plan.endDate}` : '';
  if (hasPeriod && cycles > 0) return complete(`Plan ${plan.key} en Test Pulse: ${period}, ${cycles} ciclo(s).`);
  if (hasPeriod) return partial(`Plan ${plan.key} en Test Pulse: ${period}, pero aún no tiene ciclos.`);
  if (cycles > 0) return partial(`Plan ${plan.key} en Test Pulse: ${cycles} ciclo(s), pero falta definir sus fechas de inicio y fin en Planning.`);
  return missing(`El plan ${plan.key} en Test Pulse aún no tiene fechas ni ciclos.`);
}

// ── Public API ──────────────────────────────────────────────────────────────────────────────

// Order of the lifecycle phases, to know whether an element is due later than "Planear".
const PHASE_ORDER = ['plan', 'design', 'build', 'execute', 'release'];
export const PHASE_NAMES = { plan: 'Planear', design: 'Diseñar', build: 'Construir', execute: 'Ejecutar', release: 'Liberar' };

/**
 * Evaluates a Test Plan workbook against the 17 standard elements.
 *
 * @param {{sheets: Array<{name: string, rows: string[][]}>}} workbook - Output of readXlsx.
 * @param {Object} [context]
 * @param {number} [context.epicCount=0]   - Epics linked to the initiative (element 15).
 * @param {string} [context.defectsUrl=''] - Link to the defect-management page (element 16).
 * @param {Object} [context.testPulsePlan] - Test Plan of Test Pulse captured on the deliverable
 *        ({key, startDate, endDate, cycles} or {key, error}); covers element 14 when present.
 * @returns {{
 *   recognized: boolean,
 *   elements: Array<{number: number, name: string, status: 'complete'|'partial'|'missing',
 *                    detail: string, duePhase: string, source: string, deferred: boolean}>,
 *   totals: {total: number, complete: number, partial: number, missing: number, deferred: number},
 *   compliancePct: number
 * }}
 */
export function evaluateTestPlan(workbook, context = {}) {
  const strategy = findSheet(workbook, 'estrategia');
  const resources = findSheet(workbook, 'recurso');
  const inputs = findSheet(workbook, 'insumo', 'datos');
  const risks = findSheet(workbook, 'riesgo');
  const planning = findSheet(workbook, 'planeacion');
  // The workbook is "ours" when it has the strategy sheet plus at least one of the others.
  const recognized = Boolean(strategy && (resources || inputs || risks || planning));

  const epicCount = Math.max(0, Number(context.epicCount) || 0);
  const defectsUrl = String(context.defectsUrl || '').trim();
  const testPulsePlan = context.testPulsePlan && context.testPulsePlan.key ? context.testPulsePlan : null;

  const definitions = [
    [1, 'Identificación del proyecto y responsable', 'plan', 'excel', () => checkIdentification(strategy, planning)],
    [2, 'Aprobadores', 'plan', 'excel', () => checkApprovers(strategy)],
    [3, 'Control de cambios y versión', 'plan', 'excel', () => checkChangeLog(strategy)],
    [4, 'Alcance', 'plan', 'excel', () => checkScope(strategy)],
    [5, 'Niveles y tipos de prueba', 'plan', 'excel', () => checkLevels(strategy)],
    [6, 'Ambientes', 'plan', 'excel', () => checkEnvironments(strategy)],
    [7, 'Criterios de entrada o reanudación', 'plan', 'excel', () => byText(textUnder(strategy, 'criterios de inicio o reanudacion'), 'Criterios de inicio o reanudación')],
    [8, 'Criterios de salida o aceptación', 'plan', 'excel', () => byText(textUnder(strategy, 'criterios de aceptacion'), 'Criterios de aceptación')],
    [9, 'Criterios de suspensión', 'plan', 'excel', () => byText(textUnder(strategy, 'criterios de suspension'), 'Criterios de suspensión')],
    [10, 'Recursos y roles', 'plan', 'excel', () => checkResources(resources)],
    [11, 'Datos e insumos', 'design', 'excel', () => checkInputs(inputs)],
    [12, 'Riesgos', 'plan', 'excel', () => checkRisks(risks)],
    [13, 'Calendario', 'plan', 'excel', () => checkSchedule(planning)],
    // 14: Test Pulse is the source when a plan was captured; otherwise the Excel is read. If the
    // Excel already has both, that is accepted too (whichever source is complete wins).
    [14, 'Periodo y ciclos', 'build', testPulsePlan ? 'testpulse' : 'excel', () => {
      const fromExcel = checkPeriodAndCycles(strategy);
      if (!testPulsePlan) {
        return fromExcel.status === 'complete'
          ? fromExcel
          : { ...fromExcel, detail: `${fromExcel.detail} También se puede cubrir capturando el plan de Test Pulse en este entregable.` };
      }
      const fromTestPulse = checkPeriodAndCyclesInTestPulse(testPulsePlan);
      return fromTestPulse.status !== 'complete' && fromExcel.status === 'complete' ? fromExcel : fromTestPulse;
    }],
    [15, 'Entregables de prueba', 'build', 'jira', () => (epicCount > 0
      ? complete(`${epicCount} épica(s) vinculada(s) a la iniciativa; sus historias, matrices y casos se ven en la fase Construir.`)
      : missing('Aún no hay épicas vinculadas a la iniciativa.'))],
    [16, 'Gestión de defectos', 'plan', 'confluence', () => (defectsUrl
      ? complete('Documento de gestión de defectos enlazado en Confluence.')
      : missing('Falta capturar el enlace al documento de gestión de defectos en Confluence.'))],
    [17, 'Métricas y reportes', 'plan', 'testpulse', () => complete('Cubierto por el módulo Reports de Test Pulse.')]
  ];

  const elements = definitions.map(([number, name, duePhase, source, check]) => {
    let result;
    try {
      result = check();
    } catch (error) {
      // A malformed sheet must not break the whole evaluation.
      result = missing('No se pudo leer esta sección del Excel.');
    }
    // Not complete yet, but only due in a later phase → deferred, not counted against the plan.
    const deferred = result.status !== 'complete' && PHASE_ORDER.indexOf(duePhase) > 0;
    return { number, name, status: result.status, detail: result.detail, duePhase, source, deferred };
  });

  const totals = {
    total: elements.length,
    complete: elements.filter(e => e.status === 'complete').length,
    partial: elements.filter(e => e.status === 'partial' && !e.deferred).length,
    missing: elements.filter(e => e.status === 'missing' && !e.deferred).length,
    deferred: elements.filter(e => e.deferred).length
  };
  // Compliance over what is due now: deferred elements are left out of the denominator.
  const due = totals.total - totals.deferred;
  const compliancePct = due > 0 ? Math.round((totals.complete / due) * 100) : 0;

  return { recognized, elements, totals, compliancePct };
}
