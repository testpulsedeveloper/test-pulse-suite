/**
 * @file lifecycle.test.js
 * @description v4.17.0 "Ciclo de vida": the Confluence findings report is read into totals, and
 * the lifecycle resolvers are wired with the right permissions.
 *
 * The sample page reproduces the structure of the real report
 * "Hallazgos documentación BRD / ERF Tarjetas Internas" (5 findings, one of them closed in the
 * "Tipo de hallazgo" column, no "Estado" column, maturity stated in the text).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractConfluencePageId, parseFindingsReport } from '../src/utils/confluenceFindingsParser.js';
import {
  sanitizeLifecycleEditors,
  isListedLifecycleEditor,
  lifecycleEditorsKey,
  MAX_LIFECYCLE_EDITORS
} from '../src/utils/lifecycleEditors.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');

const row = (cells, tag = 'td') => `<tr>${cells.map(c => `<${tag}><p>${c}</p></${tag}>`).join('')}</tr>`;
const HEADERS = ['ID', 'Tipo de hallazgo', 'Sección / referencia', 'Descripción del hallazgo', 'Impacto', 'Sugerencia de QA', 'Responsable de aclaración'];

const SAMPLE_PAGE = `
<h1>Hallazgos documentaci&oacute;n BRD / ERF Tarjetas Internas</h1>
<h2>1. Datos generales del an&aacute;lisis</h2>
<p><strong>Documento analizado:</strong> ERF / BRD</p>
<p><strong>Nombre del documento:</strong> ERF Tarjetas Internas- BRD-26-004-Tenders-cards</p>
<p><strong>Versi&oacute;n:</strong> BRD 20/08/2026 / ERF 20/08/2026</p>
<p><strong>Proyecto / Iniciativa:</strong> Comercio Unificado</p>
<p><strong>Analista QA:</strong> David Hern&aacute;ndez Santos</p>
<p><strong>Fecha del an&aacute;lisis:</strong> 21/08/2026</p>
<p><strong>Fuente del documento:</strong></p>
<p><strong>Resultado general:</strong></p>
<p><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">CORREGIDO</ac:parameter></ac:structured-macro></p>
<h2>4. Resumen ejecutivo de hallazgos</h2>
<p>La documentaci&oacute;n de Tarjetas Internas ha alcanzado un nivel de madurez del 85%.</p>
<h2>5. Detalle de hallazgos</h2>
<table><tbody>
${row(HEADERS, 'th')}
${row(['H01', 'Contradicción', 'ERF (UJ Internas) vs BRD (REQ-CT-04)', 'El ERF prohíbe cancelaciones parciales.', 'Alto', 'Definir que la anulación sí permite parciales.', 'William Ari Santamaria (BA)'])}
${row(['H02', 'Ambigüedad', 'ERF (SAP RH) vs BRD (REQ-MP-03)', 'ID de empleado de 8 vs 36 dígitos.', 'Alto', 'Especificar el envío de 36 dígitos.', 'William Ari Santamaria (BA)'])}
${row(['H03', 'Vacío', 'ERF (Carga de bines)', 'No define alertas por Timeout.', 'Bajo', 'Definir el umbral de alertas.', ''])}
${row(['H04', 'Información Faltante', 'BRD (REQ-HC-08)', 'No especifica la fecha de servidor.', 'Medio', 'Usar la fecha del servidor.', ''])}
${row(['H05', 'Cerrado', 'ERF (Control de Versiones)', 'La carga de llaves se movió a precondición.', 'N/A', 'Hallazgo cerrado exitosamente.', ''])}
</tbody></table>`;

test('extractConfluencePageId accepts page links and rejects the rest', () => {
  assert.equal(extractConfluencePageId('https://liverpooldigital.atlassian.net/wiki/spaces/CU/pages/123456789/Hallazgos+ERF'), '123456789');
  assert.equal(extractConfluencePageId('https://x.atlassian.net/wiki/spaces/CU/pages/edit-v2/987654321?draftShareId=1'), '987654321');
  assert.equal(extractConfluencePageId('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=555666777'), '555666777');
  assert.equal(extractConfluencePageId('123456789'), '123456789');
  assert.equal(extractConfluencePageId('https://x.atlassian.net/wiki/x/AbCdEf'), null);
  assert.equal(extractConfluencePageId(''), null);
});

test('the real report structure is read into general data, findings and totals', () => {
  const report = parseFindingsReport(SAMPLE_PAGE);
  assert.equal(report.recognized, true);
  assert.equal(report.hasStatusColumn, false);

  assert.equal(report.general.documentType, 'ERF / BRD');
  assert.equal(report.general.initiative, 'Comercio Unificado');
  assert.equal(report.general.analyst, 'David Hernández Santos');
  assert.equal(report.general.analysisDate, '21/08/2026');
  // The status lozenge sits on the line below its label; its colour parameter is not text.
  assert.equal(report.general.overallResult, 'CORREGIDO');

  assert.equal(report.findings.length, 5);
  assert.deepEqual(report.findings.map(f => f.id), ['H01', 'H02', 'H03', 'H04', 'H05']);
  assert.equal(report.findings[0].owner, 'William Ari Santamaria (BA)');

  assert.deepEqual(report.totals.byImpact, { Alto: 2, Bajo: 1, Medio: 1, 'N/A': 1 });
  // Without an "Estado" column, H05 ("Cerrado" in the type column) is the closed one.
  assert.equal(report.totals.closed, 1);
  assert.equal(report.totals.open, 4);
  assert.deepEqual(report.totals.openByImpact, { Alto: 2, Bajo: 1, Medio: 1 });

  assert.equal(report.maturityPct, 85);
  assert.equal(report.maturitySource, 'document');
});

test('section 9 "Estado de atención de hallazgos" decides the status of each finding (v4.18.1)', () => {
  // Same shape as the real report: detail table (section 5) without status, and the attention
  // table (section 9) with ID | Estado | Respuesta funcional | Ajuste requerido en documento.
  const page = `<h2>5. Detalle de hallazgos</h2><table><tbody>
    ${row(['ID', 'Tipo de hallazgo', 'Descripción', 'Impacto'], 'th')}
    ${row(['H01', 'Contradicción', 'x', 'Alto'])}
    ${row(['H02', 'Ambigüedad', 'x', 'Alto'])}
    ${row(['H03', 'Vacío', 'x', 'Medio'])}
    ${row(['H04', 'Cerrado', 'x', 'Bajo'])}
  </tbody></table>
  <h2>9. Estado de atención de hallazgos</h2><table><tbody>
    ${row(['ID', 'Estado', 'Respuesta funcional', 'Ajuste requerido en documento'], 'th')}
    ${row(['H-01', 'Aclarado', 'Se cambia cancelación por anulación', 'SI'])}
    ${row(['h02', 'En revisión', 'Negocio aún no define', 'SI'])}
    ${row(['H03', '', '', ''])}
  </tbody></table>`;
  const report = parseFindingsReport(page);
  assert.equal(report.recognized, true);
  assert.equal(report.hasStatusColumn, true);
  assert.equal(report.statusSource, 'attention-table');
  assert.deepEqual(report.findings.map(f => f.status), ['Aclarado', 'En revisión', '', '']);
  // Only H01 is attended. H04 says "Cerrado" in the type column but is not in section 9 → open.
  assert.deepEqual(report.findings.map(f => f.closed), [true, false, false, false]);
  assert.equal(report.totals.closed, 1);
  assert.equal(report.totals.open, 3);
  assert.deepEqual(report.totals.byStatus, { Aclarado: 1, 'En revisión': 1, 'Sin estado': 2 });
  assert.equal(report.maturityPct, 25);
});

test('an "Estado" column decides what is closed, whatever the column order', () => {
  const page = `<table><tbody>
    ${row(['Estado', 'Impacto', 'ID', 'Tipo de hallazgo'], 'th')}
    ${row(['Corregido', 'Alto', 'H01', 'Contradicción'])}
    ${row(['Abierto', 'Crítico', 'H02', 'Vacío'])}
    ${row(['<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">CERRADO</ac:parameter></ac:structured-macro>', 'medio', 'H03', 'Ambigüedad'])}
  </tbody></table>`;
  const report = parseFindingsReport(page);
  assert.equal(report.hasStatusColumn, true);
  assert.equal(report.totals.total, 3);
  assert.equal(report.totals.closed, 2);
  assert.deepEqual(report.totals.openByImpact, { 'Crítico': 1 });
  // No maturity stated in the text → closed / total.
  assert.equal(report.maturityPct, 67);
  assert.equal(report.maturitySource, 'calculated');
});

test('a page without a findings table is reported as not recognized', () => {
  const report = parseFindingsReport('<p>Notas de la reunión</p><table><tbody><tr><th>Tema</th><th>Acuerdo</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>');
  assert.equal(report.recognized, false);
  assert.equal(report.totals.total, 0);
  assert.equal(report.maturityPct, null);
  assert.equal(parseFindingsReport('').recognized, false);
});

test('lifecycle resolvers are registered, read Confluence as the user and guard deletion', () => {
  const index = read('src/index.js');
  assert.match(index, /registerLifecycleResolvers\(resolver\)/);

  const resolvers = read('src/resolvers/lifecycleResolvers.js');
  for (const name of ['getLifecycle', 'saveLifecycleInitiative', 'deleteLifecycleInitiative', 'refreshLifecycleFindings', 'getLifecycleProgress']) {
    assert.match(resolvers, new RegExp(`resolver\\.define\\('${name}'`));
  }
  // Confluence is read with the user's own permissions, never as the app.
  assert.match(resolvers, /api\.asUser\(\)\.requestConfluence\(/);
  assert.doesNotMatch(resolvers, /asApp\(\)\.requestConfluence/);
  const deletion = resolvers.slice(resolvers.indexOf("define('deleteLifecycleInitiative'"), resolvers.indexOf("define('refreshLifecycleFindings'"));
  assert.match(deletion, /requireProjectAdmin\(projectId, context\)/);

  assert.match(read('manifest.yml'), /- read:page:confluence/);
});

test('the Lifecycle tab is lazy-loaded and does nothing until it is opened', () => {
  const app = read('static/hello-world/src/App.js');
  assert.match(app, /const LifecycleView = React\.lazy\(/);
  assert.match(app, /activeTab === 'lifecycle' && renderLifecycleTab\(\)/);
  // No lifecycle resolver is called from App.js (startup): only the view calls them.
  assert.doesNotMatch(app, /invoke\('(getLifecycle|refreshLifecycleFindings|getLifecycleProgress)'/);
});

test('lifecycle editors list is cleaned before it is stored (v4.19.0)', () => {
  const editors = sanitizeLifecycleEditors([
    { accountId: '712020:abc-123', displayName: '  Ana QA  ', avatarUrl: 'https://avatar.example/a.png' },
    { accountId: '712020:abc-123', displayName: 'Duplicate' },
    { accountId: 'bad id with spaces', displayName: 'Nope' },
    { accountId: '5b10ac8d82e05b22cc7d4ef5', avatarUrl: 'javascript:alert(1)' },
    null
  ]);
  assert.deepEqual(editors, [
    { accountId: '712020:abc-123', displayName: 'Ana QA', avatarUrl: 'https://avatar.example/a.png' },
    { accountId: '5b10ac8d82e05b22cc7d4ef5', displayName: '5b10ac8d82e05b22cc7d4ef5', avatarUrl: '' }
  ]);
  assert.deepEqual(sanitizeLifecycleEditors('not a list'), []);
  const many = Array.from({ length: 80 }, (_, i) => ({ accountId: `user${i}` }));
  assert.equal(sanitizeLifecycleEditors(many).length, MAX_LIFECYCLE_EDITORS);

  assert.equal(isListedLifecycleEditor(editors, '712020:abc-123'), true);
  assert.equal(isListedLifecycleEditor(editors, 'someone-else'), false);
  assert.equal(isListedLifecycleEditor(editors, ''), false);
  assert.equal(isListedLifecycleEditor(null, '712020:abc-123'), false);
  // The editors key must not start with the prefix used to list initiatives ("lifecycle_<id>_").
  assert.equal(lifecycleEditorsKey('10001').startsWith('lifecycle_'), false);
});

test('only lifecycle editors can save, and only project admins manage the list (v4.19.0)', () => {
  const resolvers = read('src/resolvers/lifecycleResolvers.js');
  const body = (name, next) => resolvers.slice(resolvers.indexOf(`resolver.define('${name}'`), resolvers.indexOf(`resolver.define('${next}'`));
  assert.match(body('saveLifecycleInitiative', 'deleteLifecycleInitiative'), /await requireLifecycleEditor\(projectId, context\)/);
  assert.match(body('saveLifecycleEditors', 'saveLifecycleInitiative'), /await requireProjectAdmin\(projectId, context\)/);
  assert.match(body('getLifecycle', 'getLifecycleEditors'), /canEditLifecycle\(projectId, context\)/);
  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /canEdit && !initiativeForm/);
  assert.match(read('static/hello-world/src/views/SettingsView.jsx'), /<LifecycleEditorsCard /);
});

test('phases 03 and 04 take several deliverables: epics with stories, plans with cycles (v4.21.0)', () => {
  const resolvers = read('src/resolvers/lifecycleResolvers.js');
  // Per-epic breakdown and the Test Plans with their cycles come from the same resolver.
  assert.match(resolvers, /epics: \[\.\.\.epicMap\.values\(\)\]/);
  assert.match(resolvers, /plans\.push\(await readTestPulsePlanDetail\(planKey, cycleCache\)\)/);
  assert.match(resolvers, /\['testops-plan-link', 'testpulse-v2', 'execution-meta'\]/);
  // Plan keys are stored on the initiative, cleaned and bounded.
  assert.match(resolvers, /planKeys: \[\.\.\.new Set\(/);
  assert.match(resolvers, /slice\(0, MAX_PLANS\)/);

  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /\+ Agregar épica/);
  assert.match(view, /\+ Agregar plan de pruebas/);
  assert.match(view, /handleAddKey\(initiative, field\)/);
  assert.match(view, /planKeys: initiative\.planKeys \|\| \[\]/);
  // Adding and removing are edit actions: only shown to lifecycle editors.
  assert.match(view, /canEdit && phase\.auto/);
});
