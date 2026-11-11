/**
 * @file lifecycleResolvers.js
 * @description Backend of the "Ciclo de vida" view (v4.17.0): shows, per initiative, the five
 * phases of the QA framework (Planear, Diseñar, Construir, Ejecutar, Liberar) and the
 * deliverables produced in each one.
 *
 * Why initiatives are their own record and not a Jira epic:
 *   The Shift-Left phase (static review of BRD / ERF / Functional Spec) happens BEFORE the epic
 *   and its stories exist. An initiative is therefore created first, and the epics are linked to
 *   it later, when they are written.
 *
 * Where data lives:
 *   - Initiatives and their deliverables: Forge Key-Value Storage, one key per initiative
 *     (`lifecycle_<projectId>_<initiativeId>`), so two people editing different initiatives never
 *     overwrite each other.
 *   - Findings reports stay in CONFLUENCE. Test Pulse only reads the page (as the current user,
 *     so Confluence enforces who may see it) and stores the totals next to the deliverable.
 *   - Phases 3 and 4 (cases, executions, bugs) are calculated from Jira on demand.
 *
 * Authorization:
 *   Every resolver receives `projectId`, so the central filter in index.js has already verified
 *   that the user is a member of the project before any code here runs. Deleting an initiative
 *   additionally requires being a project administrator.
 */

import api, { route } from '@forge/api';
import { kvs as storage, WhereConditions } from '@forge/kvs';
import { requireProjectAdmin, canAdministerProject, AuthorizationError, normalizeProjectRef } from '../utils/authz.js';
import {
  lifecycleEditorsKey,
  sanitizeLifecycleEditors,
  isListedLifecycleEditor
} from '../utils/lifecycleEditors.js';
import { jqlQuote } from '../utils/jqlHelpers.js';
import { extractConfluencePageId, parseFindingsReport } from '../utils/confluenceFindingsParser.js';
import { readXlsx } from '../utils/xlsxReader.js';
import { evaluateTestPlan } from '../utils/testPlanChecklist.js';

// The five phases of the framework, in order. The ids are stored; the labels live in the UI.
export const LIFECYCLE_PHASES = ['plan', 'design', 'build', 'execute', 'release'];

const DELIVERABLE_STATUSES = ['pending', 'in_progress', 'delivered'];
const MAX_INITIATIVES = 100;
const MAX_DELIVERABLES_PER_PHASE = 30;
const MAX_EPICS = 20;
// Test Plan workbook (v4.20.0): the biggest Excel attachment Test Pulse will download and read.
const MAX_TEST_PLAN_BYTES = 5 * 1024 * 1024;

/** "cuq-123 " → "CUQ-123"; anything that is not a Jira issue key → ''. */
const issueKeyOf = (value) => {
  const key = text(value, 30).toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : '';
};

const keyPrefix = (projectId) => `lifecycle_${projectId}_`;

/** Trims a value to a safe, bounded string. */
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/** Only http(s) links are stored, so a deliverable link can never run script when clicked. */
const safeUrl = (value) => {
  const url = text(value, 1000);
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
};

/** A short random id for initiatives and deliverables. */
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const isSafeId = (value) => /^[a-z0-9]{6,24}$/i.test(String(value || ''));

/**
 * Cleans a deliverable sent by the browser. Fields Test Pulse calculates (`report`) are never
 * taken from the browser: they are copied from the stored record instead.
 *
 * @param {Object} raw - Deliverable as sent by the UI.
 * @param {Object} [stored] - The same deliverable as currently stored, if it exists.
 * @returns {Object}
 */
function sanitizeDeliverable(raw, stored) {
  const url = safeUrl(raw?.url);
  // 'findings' = Shift-Left report read from Confluence; 'testplan' = Test Plan workbook attached
  // to a Jira issue and checked against the 17 standard elements; 'link' = any other document.
  const kind = ['findings', 'testplan'].includes(raw?.kind) ? raw.kind : 'link';
  const clean = {
    id: isSafeId(raw?.id) ? String(raw.id) : newId(),
    kind,
    name: text(raw?.name, 160) || 'Entregable',
    docType: text(raw?.docType, 40),
    url,
    owner: text(raw?.owner, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date || '')) ? String(raw.date) : '',
    status: DELIVERABLE_STATUSES.includes(raw?.status) ? raw.status : 'pending',
    notes: text(raw?.notes, 600)
  };
  // Keep the last report read from Confluence only while the link still points to the same page.
  if (kind === 'findings' && stored?.report && stored.url === url) {
    clean.report = stored.report;
  }
  if (kind === 'testplan') {
    // Where the Excel is attached, and the link that covers element 16 (defect management).
    clean.issueKey = issueKeyOf(raw?.issueKey);
    clean.defectsUrl = safeUrl(raw?.defectsUrl);
    // Keep the last evaluation only while it still refers to the same Jira issue.
    if (stored?.report && stored.issueKey === clean.issueKey) clean.report = stored.report;
  }
  return clean;
}

/** Cleans a whole initiative sent by the browser, preserving server-side fields. */
function sanitizeInitiative(raw, stored, accountId) {
  const now = new Date().toISOString();
  const phases = {};
  for (const phase of LIFECYCLE_PHASES) {
    const storedList = stored?.phases?.[phase]?.deliverables || [];
    const rawList = Array.isArray(raw?.phases?.[phase]?.deliverables) ? raw.phases[phase].deliverables : [];
    phases[phase] = {
      deliverables: rawList.slice(0, MAX_DELIVERABLES_PER_PHASE).map(d =>
        sanitizeDeliverable(d, storedList.find(s => s.id === d?.id))
      )
    };
  }
  const epicKeys = (Array.isArray(raw?.epicKeys) ? raw.epicKeys : [])
    .map(k => text(k, 30).toUpperCase())
    .filter(k => /^[A-Z][A-Z0-9_]*-\d+$/.test(k));

  return {
    id: stored?.id || newId(),
    name: text(raw?.name, 120) || 'Iniciativa sin nombre',
    description: text(raw?.description, 600),
    epicKeys: [...new Set(epicKeys)].slice(0, MAX_EPICS),
    phases,
    createdAt: stored?.createdAt || now,
    createdBy: stored?.createdBy || accountId || null,
    updatedAt: now,
    updatedBy: accountId || null
  };
}

/** Lists every initiative of a project, newest first. */
async function listInitiatives(projectId) {
  const prefix = keyPrefix(projectId);
  const initiatives = [];
  let cursor;
  do {
    let query = storage.query().where('key', WhereConditions.beginsWith(prefix)).limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const item of page?.results || []) {
      if (item?.value?.id) initiatives.push(item.value);
    }
    cursor = page?.nextCursor;
  } while (cursor && initiatives.length < MAX_INITIATIVES);
  return initiatives.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Storage keys are built from the project reference, so it must be a well-formed ID or key. */
const projectKeyPart = (projectId) => {
  const ref = normalizeProjectRef(projectId);
  if (!ref) throw new Error('Proyecto inválido.');
  return String(ref);
};

/**
 * Reads a findings report from Confluence as the current user and returns its summary.
 * Never throws: a page that cannot be read produces `{ error }`, which the UI shows next to
 * the deliverable while keeping the previous numbers.
 *
 * @param {string} url - Link to the Confluence page.
 * @returns {Promise<Object>}
 */
async function readFindingsReport(url) {
  const fetchedAt = new Date().toISOString();
  const pageId = extractConfluencePageId(url);
  if (!pageId) {
    return { fetchedAt, error: 'El enlace no es de una página de Confluence. Usa el enlace completo (…/wiki/spaces/…/pages/123456/…), no el enlace corto.' };
  }
  let response;
  try {
    response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`, {
      headers: { Accept: 'application/json' }
    });
  } catch (e) {
    console.warn('[lifecycle] Confluence request failed:', e?.message);
    return { fetchedAt, pageId, error: 'No se pudo consultar Confluence. Verifica que Test Pulse esté instalado en Confluence y que hayas aceptado el permiso.' };
  }
  if (response.status === 404) {
    return { fetchedAt, pageId, error: 'La página no existe o no tienes permiso para verla en Confluence.' };
  }
  if (!response.ok) {
    console.warn(`[lifecycle] Confluence page ${pageId} answered ${response.status}`);
    return { fetchedAt, pageId, error: `Confluence no permitió leer la página (HTTP ${response.status}).` };
  }
  const page = await response.json();
  const parsed = parseFindingsReport(page?.body?.storage?.value || '');
  return {
    fetchedAt,
    pageId,
    pageTitle: text(page?.title, 255),
    pageVersion: page?.version?.number || null,
    pageUpdatedAt: page?.version?.createdAt || null,
    recognized: parsed.recognized,
    hasStatusColumn: parsed.hasStatusColumn,
    // 'attention-table' = statuses read from section 9, "Estado de atención de hallazgos".
    statusSource: parsed.statusSource,
    general: parsed.general,
    totals: parsed.totals,
    // Only what the UI lists: no descriptions, the full text stays in Confluence.
    findings: parsed.findings.map(f => ({ id: f.id, type: f.type, impact: f.impact, owner: f.owner, status: f.status, closed: f.closed })),
    maturityPct: parsed.maturityPct,
    maturitySource: parsed.maturitySource,
    error: parsed.recognized ? null : 'No se encontró la tabla de hallazgos. La tabla de detalle debe tener una columna "ID" y columnas como "Tipo de hallazgo" e "Impacto"; el estado se toma de la tabla "Estado de atención de hallazgos" (ID y Estado).'
  };
}

/**
 * Reads the Test Plan workbook attached to a Jira issue, as the current user, and checks it
 * against the 17 standard elements (see testPlanChecklist.js). Never throws: a problem produces
 * `{ error }`, shown next to the deliverable while the previous evaluation is kept.
 *
 * Which attachment is used: the newest .xlsx of the issue; when several exist, one whose name
 * contains "plan" is preferred. Uploading a new version to the same issue is enough to update.
 *
 * @param {Object} deliverable - Stored deliverable of kind 'testplan' (issueKey, defectsUrl).
 * @param {Object} initiative - Stored initiative (its epics cover element 15).
 * @returns {Promise<Object>}
 */
async function readTestPlanReport(deliverable, initiative) {
  const fetchedAt = new Date().toISOString();
  const base = { reportKind: 'testplan', fetchedAt, issueKey: deliverable.issueKey || '' };
  if (!deliverable.issueKey) {
    return { ...base, error: 'Captura la clave de la incidencia de Jira donde está adjunto el Excel del plan (por ejemplo CUQ-123).' };
  }
  try {
    // 1. List the attachments of the issue (Jira checks that the user can see the issue).
    const issueRes = await api.asUser().requestJira(route`/rest/api/3/issue/${deliverable.issueKey}?fields=attachment`, {
      headers: { Accept: 'application/json' }
    });
    if (!issueRes.ok) {
      return { ...base, error: `Jira no permitió leer la incidencia ${deliverable.issueKey} (HTTP ${issueRes.status}).` };
    }
    const attachments = ((await issueRes.json())?.fields?.attachment || [])
      .filter(item => /\.xlsx$/i.test(String(item?.filename || '')))
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));
    const attachment = attachments.find(item => /plan/i.test(item.filename)) || attachments[0];
    if (!attachment) {
      return { ...base, error: `La incidencia ${deliverable.issueKey} no tiene ningún Excel (.xlsx) adjunto.` };
    }
    const fileInfo = {
      fileName: text(attachment.filename, 255),
      fileCreated: attachment.created || null,
      fileAuthor: text(attachment.author?.displayName, 120)
    };
    if (Number(attachment.size) > MAX_TEST_PLAN_BYTES) {
      return { ...base, ...fileInfo, error: 'El Excel adjunto pesa más de 5 MB; no se puede evaluar.' };
    }

    // 2. Download it and read its cells.
    const contentRes = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${String(attachment.id)}`);
    if (contentRes.status !== 200) {
      return { ...base, ...fileInfo, error: `No se pudo descargar el Excel adjunto (HTTP ${contentRes.status}).` };
    }
    const workbook = readXlsx(Buffer.from(await contentRes.arrayBuffer()));

    // 3. Check the 17 elements.
    const evaluation = evaluateTestPlan(workbook, {
      epicCount: (initiative?.epicKeys || []).length,
      defectsUrl: deliverable.defectsUrl
    });
    return {
      ...base,
      ...fileInfo,
      recognized: evaluation.recognized,
      elements: evaluation.elements,
      totals: evaluation.totals,
      compliancePct: evaluation.compliancePct,
      error: evaluation.recognized ? null : 'El Excel no tiene la estructura de la plantilla de Plan de Pruebas (hojas "Estrategia", "Recursos", "Datos o Insumos", "Registro de riesgos" y "Planeación").'
    };
  } catch (e) {
    console.warn('[lifecycle] test plan read failed:', e?.message);
    return { ...base, error: `No se pudo leer el Excel del plan: ${e?.message || 'error desconocido'}` };
  }
}

/** Runs one page of a JQL search as the current user. */
async function searchPage(jql, fields, nextPageToken) {
  const body = { jql, fields, maxResults: 100 };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Jira no pudo completar la búsqueda (HTTP ${response.status}).`);
  return response.json();
}

/** Runs a JQL search up to `maxIssues` issues. */
async function searchAll(jql, fields, maxIssues) {
  const issues = [];
  let token;
  do {
    const page = await searchPage(jql, fields, token);
    issues.push(...(page.issues || []));
    token = page.nextPageToken;
  } while (token && issues.length < maxIssues);
  return issues.slice(0, maxIssues);
}

// Issue type names are matched loosely so the projects' own names keep working.
const typeName = (issue) => String(issue?.fields?.issuetype?.name || '').toLowerCase();
const isTestCase = (issue) => { const t = typeName(issue); return t.includes('test case') || t.includes('caso de prueba'); };
const isTestRun = (issue) => typeName(issue).includes('test run');
const isBug = (issue) => { const t = typeName(issue); return t === 'bug' || t === 'error' || t.includes('defect'); };
const linkedIssues = (issue) => (issue?.fields?.issuelinks || []).map(l => l.outwardIssue || l.inwardIssue).filter(Boolean);

/**
 * Calculates phases 3 (Construir) and 4 (Ejecutar) for the epics of an initiative:
 * stories, stories with at least one test case, test cases, executions by status and bugs.
 *
 * Costs 2 searches for a typical initiative (stories, then test cases), read as the user.
 *
 * @param {string[]} epicKeys
 * @returns {Promise<Object>}
 */
async function computeProgress(epicKeys) {
  const empty = { stories: 0, storiesWithCases: 0, cases: 0, runs: { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, other: 0 }, bugs: { total: 0, open: 0 }, truncated: false };
  if (!epicKeys.length) return empty;

  const epicList = epicKeys.map(k => jqlQuote(k)).join(',');
  const stories = await searchAll(`parent in (${epicList})`, ['issuetype', 'issuelinks', 'status'], 300);

  const caseKeys = new Set();
  const bugs = new Map(); // key → is it open?
  let storiesWithCases = 0;
  const noteBug = (issue) => bugs.set(issue.key, issue?.fields?.status?.statusCategory?.key !== 'done');

  for (const story of stories) {
    if (isTestCase(story) || isTestRun(story)) continue; // defensive: only requirements count as stories
    if (isBug(story)) { noteBug(story); continue; }
    const links = linkedIssues(story);
    const storyCases = links.filter(isTestCase);
    if (storyCases.length > 0) storiesWithCases++;
    storyCases.forEach(c => caseKeys.add(c.key));
    links.filter(isBug).forEach(noteBug);
  }
  const storyCount = stories.filter(s => !isTestCase(s) && !isTestRun(s) && !isBug(s)).length;

  // Executions: every Test Run is linked to its Test Case, and the link carries the run's status.
  const runs = { ...empty.runs };
  const seenRuns = new Set();
  const caseList = [...caseKeys].slice(0, 1000);
  for (let i = 0; i < caseList.length; i += 100) {
    const chunk = caseList.slice(i, i + 100).map(k => jqlQuote(k)).join(',');
    const cases = await searchAll(`key in (${chunk})`, ['issuelinks'], 100);
    for (const testCase of cases) {
      for (const linked of linkedIssues(testCase)) {
        if (isBug(linked)) { noteBug(linked); continue; }
        if (!isTestRun(linked) || seenRuns.has(linked.key)) continue;
        seenRuns.add(linked.key);
        const status = String(linked?.fields?.status?.name || '').toLowerCase();
        runs.total++;
        if (status.startsWith('pass')) runs.passed++;
        else if (status.startsWith('fail')) runs.failed++;
        else if (status.startsWith('block')) runs.blocked++;
        else if (status === 'not run' || status === 'to do') runs.notRun++;
        else runs.other++;
      }
    }
  }

  return {
    stories: storyCount,
    storiesWithCases,
    cases: caseKeys.size,
    runs,
    bugs: { total: bugs.size, open: [...bugs.values()].filter(Boolean).length },
    truncated: stories.length >= 300 || caseKeys.size > 1000
  };
}

/**
 * Registers the lifecycle resolvers on the shared Forge Resolver instance.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
/** Reads the editors list of a project (empty when nobody has been picked yet). */
async function readLifecycleEditors(projectId) {
  const stored = await storage.get(lifecycleEditorsKey(projectId));
  return Array.isArray(stored?.editors) ? stored.editors : [];
}

/**
 * Can the current user change the lifecycle of `projectId`? (v4.19.0)
 * Project administrators and superusers always can; everybody else only when a project
 * administrator added them to the editors list in Settings.
 *
 * @param {string} projectId - Project id already cleaned with projectKeyPart.
 * @param {Object} context - Forge resolver context (`context.accountId`).
 * @returns {Promise<boolean>}
 */
async function canEditLifecycle(projectId, context) {
  if (await canAdministerProject(projectId, context)) return true;
  return isListedLifecycleEditor(await readLifecycleEditors(projectId), context?.accountId);
}

/** Throws `AuthorizationError('FORBIDDEN')` unless the user may change the lifecycle. */
async function requireLifecycleEditor(projectId, context) {
  if (!(await canEditLifecycle(projectId, context))) {
    throw new AuthorizationError('FORBIDDEN', 'Solo los editores de Lifecycle de este proyecto pueden hacer cambios. Pide a un administrador del proyecto que te agregue en Configuración.');
  }
}

export const registerLifecycleResolvers = (resolver) => {
  // Lists the initiatives of a project with their phases and deliverables. Everybody who can use
  // Test Pulse in the project can read it; `canEdit` tells the UI whether to show edit controls
  // (the server checks again on every change, the flag is only for display).
  resolver.define('getLifecycle', async ({ payload, context }) => {
    const projectId = projectKeyPart(payload.projectId);
    const [initiatives, canEdit] = await Promise.all([
      listInitiatives(projectId),
      canEditLifecycle(projectId, context)
    ]);
    return { initiatives, canEdit };
  });

  // Returns who may edit the lifecycle of the project, for the Settings card.
  resolver.define('getLifecycleEditors', async ({ payload, context }) => {
    const projectId = projectKeyPart(payload.projectId);
    const [editors, canManage] = await Promise.all([
      readLifecycleEditors(projectId),
      canAdministerProject(projectId, context)
    ]);
    return { editors, canManage };
  });

  // Replaces the editors list of the project (project administrators only).
  resolver.define('saveLifecycleEditors', async ({ payload, context }) => {
    const projectId = projectKeyPart(payload.projectId);
    await requireProjectAdmin(projectId, context);
    const editors = sanitizeLifecycleEditors(payload.editors);
    await storage.set(lifecycleEditorsKey(projectId), {
      editors,
      updatedAt: new Date().toISOString(),
      updatedBy: context?.accountId || null
    });
    return { editors };
  });

  // Creates or updates one initiative (lifecycle editors only).
  resolver.define('saveLifecycleInitiative', async ({ payload, context }) => {
    const projectId = projectKeyPart(payload.projectId);
    await requireLifecycleEditor(projectId, context);
    const raw = payload.initiative || {};
    let stored = null;
    if (raw.id) {
      if (!isSafeId(raw.id)) throw new Error('Iniciativa inválida.');
      stored = await storage.get(`${keyPrefix(projectId)}${raw.id}`);
      if (!stored) throw new Error('La iniciativa ya no existe. Recarga la vista.');
    } else if ((await listInitiatives(projectId)).length >= MAX_INITIATIVES) {
      throw new Error(`Se alcanzó el máximo de ${MAX_INITIATIVES} iniciativas por proyecto.`);
    }
    const initiative = sanitizeInitiative(raw, stored, context?.accountId);
    await storage.set(`${keyPrefix(projectId)}${initiative.id}`, initiative);
    return { initiative };
  });

  // Deletes an initiative (project administrators only). Jira and Confluence are not touched.
  resolver.define('deleteLifecycleInitiative', async ({ payload, context }) => {
    const projectId = projectKeyPart(payload.projectId);
    await requireProjectAdmin(projectId, context);
    if (!isSafeId(payload.initiativeId)) throw new Error('Iniciativa inválida.');
    await storage.delete(`${keyPrefix(projectId)}${payload.initiativeId}`);
    return { deleted: true };
  });

  // Re-reads from Confluence the findings report(s) of an initiative and stores their totals.
  // `deliverableId` limits the refresh to one report; without it, every report is refreshed.
  resolver.define('refreshLifecycleFindings', async ({ payload }) => {
    const projectId = projectKeyPart(payload.projectId);
    if (!isSafeId(payload.initiativeId)) throw new Error('Iniciativa inválida.');
    const key = `${keyPrefix(projectId)}${payload.initiativeId}`;
    const initiative = await storage.get(key);
    if (!initiative) throw new Error('La iniciativa ya no existe. Recarga la vista.');

    const targets = [];
    for (const phase of LIFECYCLE_PHASES) {
      for (const deliverable of initiative.phases?.[phase]?.deliverables || []) {
        const wanted = !payload.deliverableId || deliverable.id === payload.deliverableId;
        if (deliverable.kind === 'findings' && deliverable.url && wanted) targets.push(deliverable);
        // v4.20.0: the Test Plan workbook attached in Jira is re-evaluated the same way.
        if (deliverable.kind === 'testplan' && wanted) targets.push(deliverable);
      }
    }
    // At most 10 pages per call keeps the resolver well inside its time limit.
    for (const deliverable of targets.slice(0, 10)) {
      const report = deliverable.kind === 'testplan'
        ? await readTestPlanReport(deliverable, initiative)
        : await readFindingsReport(deliverable.url);
      // A failed read keeps the previous numbers and only records the error.
      deliverable.report = report.error && deliverable.report?.totals
        ? { ...deliverable.report, error: report.error, fetchedAt: report.fetchedAt }
        : report;
    }
    if (targets.length > 0) {
      // Re-read before writing so an edit saved meanwhile is not lost: only reports are merged in.
      const latest = (await storage.get(key)) || initiative;
      for (const phase of LIFECYCLE_PHASES) {
        for (const deliverable of latest.phases?.[phase]?.deliverables || []) {
          // Only merge when the deliverable still points to what was read (same page or same issue).
          const refreshed = targets.find(t => t.id === deliverable.id && t.url === deliverable.url && (t.issueKey || '') === (deliverable.issueKey || ''));
          if (refreshed) deliverable.report = refreshed.report;
        }
      }
      await storage.set(key, latest);
      return { initiative: latest, refreshed: Math.min(targets.length, 10) };
    }
    return { initiative, refreshed: 0 };
  });

  // Phases 3 and 4: test design and execution figures for the epics of an initiative.
  resolver.define('getLifecycleProgress', async ({ payload }) => {
    projectKeyPart(payload.projectId);
    const epicKeys = (Array.isArray(payload.epicKeys) ? payload.epicKeys : [])
      .map(k => String(k || '').trim().toUpperCase())
      .filter(k => /^[A-Z][A-Z0-9_]*-\d+$/.test(k))
      .slice(0, MAX_EPICS);
    return computeProgress(epicKeys);
  });
};

// Exported for unit tests.
export const __test = { sanitizeInitiative, sanitizeDeliverable, safeUrl };
