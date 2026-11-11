/**
 * @file testCaseResolvers.js
 * @description Creating and editing Test Cases from Test Pulse → Design (v4.23.0), so testers no
 * longer need Jira's own screens for it.
 *
 * Fields (the same ones of the CSV template "Plantilla_Test_Cases.csv"):
 *   Resumen · Description (Pre-conditions + Test Script) · Link (is tested by) ·
 *   Nivel de Prueba · Tipo de Prueba · Tipo de Ejecución · Prioridad
 *
 * Resolvers:
 *   - getTestCaseForEdit    → the current values of one Test Case plus everything needed to edit
 *                             it in place: the options of its lists and the statuses it can move
 *                             to. One single request to Jira.
 *   - getTestCaseCreateMeta → the options of the lists for the "new Test Case" form.
 *   - saveTestCase          → creates a Test Case, or updates only what changed: fields, status
 *                             (workflow transition), epic, and the link to its story.
 *
 * Security: every request to Jira is made AS THE USER (`api.asUser()`), so Jira itself decides
 * whether that person may see, create or edit the issue. The central wrapper in index.js has
 * already checked that the user belongs to `payload.projectId`.
 *
 * Cost: reading for edit = 1 request (the options and the transitions travel in the same answer,
 * with Jira's `expand`). Saving = 1 request, plus 1 or 2 only when the story changed.
 * Creating reads the lists once (2 requests, cached 10 minutes by the browser). No searches.
 *
 * v4.23.1: the lists were empty in v4.23.0 because they were read with a resolver written for
 * another Jira response format. They now come from Jira's own metadata of the issue.
 */

import api, { route } from '@forge/api';
import { resolveCustomFields } from '../utils/customFieldConfig.js';
import { summarizeJiraError } from '../utils/jiraErrors.js';
import { normalizeIssueRef, normalizeProjectRef } from '../utils/authz.js';
import { adfToPlainText, buildTestCaseFields, buildFormOptions } from '../utils/testCaseText.js';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/** "cuq-123 " → "CUQ-123"; anything that is not a Jira issue key → ''. */
const issueKeyOf = (value) => {
  const key = String(value ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : '';
};

/**
 * The id of the option currently selected in a select-list custom field.
 * Jira returns `{id, value}` for a single select and `[{id, value}, …]` for a multi select.
 *
 * `label` (v4.23.2) is the text of that option, so the screen can always show the current value
 * even when Jira does not offer it among the options this user may choose.
 *
 * @returns {{optionId: string, label: string, multiple: boolean}}
 */
const currentOption = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  const label = first && typeof first === 'object' ? String(first.value || first.name || '') : '';
  if (Array.isArray(value)) return { optionId: String(value[0]?.id ?? ''), label, multiple: true };
  if (value && typeof value === 'object') return { optionId: String(value.id ?? ''), label, multiple: false };
  return { optionId: '', label: '', multiple: false };
};

/**
 * Turns Jira's answer to a rejected create/update into a message a tester can act on.
 * Jira explains field by field what is wrong (for example a mandatory field of the project that
 * this form does not have), and that explanation is passed on.
 */
async function jiraFailure(response, action) {
  const detail = summarizeJiraError(await response.text());
  if (response.status === 403) return `No tienes permiso en Jira para ${action} este caso de prueba.`;
  if (response.status === 404) return 'El caso de prueba ya no existe o no tienes acceso a él.';
  return `Jira no permitió ${action} el caso de prueba (HTTP ${response.status}): ${detail}`;
}

/**
 * Registers the Test Case resolvers on the shared Forge Resolver instance.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
export const registerTestCaseResolvers = (resolver) => {
  // Current values of a Test Case and what is needed to edit it in place.
  resolver.define('getTestCaseForEdit', async ({ payload }) => {
    const caseRef = normalizeIssueRef(payload?.caseId);
    if (!caseRef) return { error: 'Caso de prueba inválido.' };
    const fieldIds = resolveCustomFields(payload?.config);
    const fieldList = ['summary', 'description', 'priority', 'status', 'parent', 'issuelinks', fieldIds.testLevel, fieldIds.testType, fieldIds.executionType].join(',');

    // `expand=editmeta,transitions` makes Jira add, to the same answer, the options this user
    // may choose for each field and the statuses the case can move to. No extra requests.
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/${caseRef}?fields=${fieldList}&expand=editmeta,transitions`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return { error: await jiraFailure(response, 'leer') };
    const issue = await response.json();
    const fields = issue.fields || {};
    const description = adfToPlainText(fields.description);
    const parentType = String(fields.parent?.fields?.issuetype?.name || '').toLowerCase();

    return {
      id: String(issue.id),
      key: issue.key,
      summary: String(fields.summary || ''),
      descriptionText: description.text,
      // True when the description has tables, images, links… that the text box cannot keep.
      hasRichDescription: description.hasRichContent,
      priorityId: String(fields.priority?.id ?? ''),
      priorityName: String(fields.priority?.name || ''),
      testLevel: currentOption(fields[fieldIds.testLevel]),
      testType: currentOption(fields[fieldIds.testType]),
      executionType: currentOption(fields[fieldIds.executionType]),
      statusName: String(fields.status?.name || ''),
      // Statuses the workflow allows from the current one (for this user).
      transitions: (issue.transitions || []).map(transition => ({
        id: String(transition.id),
        name: String(transition.name || ''),
        toName: String(transition.to?.name || transition.name || '')
      })),
      // Epic the case belongs to directly (its `parent`), when it has one.
      epic: fields.parent && (parentType.includes('epic') || parentType.includes('épica') || fields.parent.fields?.issuetype?.hierarchyLevel === 1)
        ? { key: String(fields.parent.key), summary: String(fields.parent.fields?.summary || '') }
        : null,
      // Options of the lists, and which fields Jira lets this user edit.
      options: buildFormOptions(issue.editmeta?.fields, fieldIds),
      // Every link of the case; the screen picks the one that points to its story.
      links: (fields.issuelinks || []).map(link => {
        const other = link.outwardIssue || link.inwardIssue;
        return {
          linkId: String(link.id),
          typeName: String(link.type?.name || ''),
          key: String(other?.key || ''),
          summary: String(other?.fields?.summary || ''),
          issueType: String(other?.fields?.issuetype?.name || '')
        };
      }).filter(link => link.key)
    };
  });

  // Options of the lists for the "new Test Case" form, from the create metadata of the project.
  resolver.define('getTestCaseCreateMeta', async ({ payload }) => {
    const projectRef = normalizeProjectRef(payload?.projectId);
    if (!projectRef) return { error: 'Proyecto inválido.' };
    const fieldIds = resolveCustomFields(payload?.config);
    const wantedType = String(payload?.issueTypeName || 'Test Case').trim().toLowerCase();

    // 1. Issue types the user can create in the project → the id of the Test Case type.
    const typesRes = await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectRef}/issuetypes?maxResults=200`, { headers: { Accept: 'application/json' } });
    if (!typesRes.ok) return { error: await jiraFailure(typesRes, 'crear') };
    const typesData = await typesRes.json();
    // Jira Cloud answers with `issueTypes`; older formats used `values`.
    const issueTypes = typesData.issueTypes || typesData.values || [];
    const issueType = issueTypes.find(type => String(type?.name || '').toLowerCase() === wantedType);
    if (!issueType) return { error: `No puedes crear incidencias de tipo "${payload?.issueTypeName || 'Test Case'}" en este proyecto.` };

    // 2. Fields of that type. Jira pages them (50 at a time by default), so every page is read:
    //    the custom fields of a project are often beyond the first page.
    const metaFields = {};
    for (let startAt = 0, page = 0; page < 10; page++) {
      const fieldsRes = await api.asUser().requestJira(
        route`/rest/api/3/issue/createmeta/${projectRef}/issuetypes/${String(issueType.id)}?startAt=${String(startAt)}&maxResults=200`,
        { headers: { Accept: 'application/json' } }
      );
      if (!fieldsRes.ok) return { error: await jiraFailure(fieldsRes, 'crear') };
      const data = await fieldsRes.json();
      const pageFields = data.fields || data.values || [];
      pageFields.forEach(field => { if (field?.fieldId) metaFields[field.fieldId] = field; });
      startAt += pageFields.length;
      if (pageFields.length === 0 || startAt >= Number(data.total ?? startAt)) break;
    }

    // Mandatory fields of the project that the form does not have: creating would fail, so the
    // form warns about them up front instead of after pressing "Crear".
    const handled = new Set(['summary', 'description', 'priority', 'project', 'issuetype', 'parent', 'reporter', fieldIds.testLevel, fieldIds.testType, fieldIds.executionType]);
    const otherRequired = Object.values(metaFields)
      .filter(field => field.required && !field.hasDefaultValue && !handled.has(field.fieldId))
      .map(field => String(field.name || field.fieldId));

    return { options: buildFormOptions(metaFields, fieldIds), otherRequired };
  });

  // Creates a Test Case (no `caseId`) or updates the changed fields of an existing one.
  resolver.define('saveTestCase', async ({ payload }) => {
    const fieldIds = resolveCustomFields(payload?.config);
    const { fields, errors } = buildTestCaseFields(payload?.changes, fieldIds);
    if (errors.length > 0) return { error: errors.join(' ') };

    const isCreate = !payload?.caseId;
    let caseId;
    let caseKey;

    if (isCreate) {
      const projectRef = normalizeProjectRef(payload?.projectId);
      const issueTypeName = String(payload?.issueTypeName || '').trim().slice(0, 80);
      if (!projectRef || !issueTypeName) return { error: 'Falta el proyecto o el tipo de incidencia del caso de prueba.' };
      if (!fields.summary) return { error: 'El resumen es obligatorio.' };
      const createBody = {
        fields: {
          ...fields,
          project: /^\d+$/.test(String(projectRef)) ? { id: String(projectRef) } : { key: String(projectRef) },
          issuetype: { name: issueTypeName }
        }
      };
      const response = await api.asUser().requestJira(route`/rest/api/3/issue`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(createBody) });
      if (!response.ok) return { error: await jiraFailure(response, 'crear') };
      const created = await response.json();
      caseId = String(created.id);
      caseKey = created.key;
    } else {
      caseId = normalizeIssueRef(payload.caseId);
      if (!caseId) return { error: 'Caso de prueba inválido.' };
      if (Object.keys(fields).length > 0) {
        const response = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ fields }) });
        if (!response.ok) return { error: await jiraFailure(response, 'actualizar') };
      }
    }

    // Status (v4.23.1): in Jira the status changes through a workflow "transition".
    let warning = null;
    const transitionId = String(payload?.transitionId ?? '');
    if (!isCreate && transitionId) {
      if (!/^\d+$/.test(transitionId)) return { error: 'El estado seleccionado no es válido.' };
      const moved = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/transitions`, {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ transition: { id: transitionId } })
      });
      if (!moved.ok) {
        return { error: `Jira no permitió cambiar el estado (HTTP ${moved.status}): ${summarizeJiraError(await moved.text())}` };
      }
    }

    // Requirement link ("is tested by"). `requirement` is only sent when it changed:
    //   key        → new requirement ('' = none)
    //   removeLinkId → link to the previous requirement, to be removed
    //   linkType   → name of the Jira link type configured for requirements
    const requirement = payload?.requirement;
    if (requirement && typeof requirement === 'object') {
      const removeLinkId = String(requirement.removeLinkId ?? '');
      if (!isCreate && /^\d+$/.test(removeLinkId)) {
        const removed = await api.asUser().requestJira(route`/rest/api/3/issueLink/${removeLinkId}`, { method: 'DELETE' });
        if (!removed.ok && removed.status !== 404) warning = 'No se pudo quitar el vínculo con el requisito anterior.';
      }
      const requirementKey = issueKeyOf(requirement.key);
      if (requirementKey) {
        const linkType = String(requirement.linkType || '').trim();
        const linked = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            // Same direction the rest of Test Pulse uses: the Test Case is the inward issue.
            type: { name: linkType && linkType !== 'ANY' ? linkType.slice(0, 80) : 'Relates' },
            inwardIssue: { id: String(caseId) },
            outwardIssue: { key: requirementKey }
          })
        });
        if (!linked.ok) {
          warning = `El caso se guardó, pero no se pudo vincular con ${requirementKey}: ${summarizeJiraError(await linked.text())}`;
        }
      }
    }

    return { success: true, created: isCreate, id: caseId, key: caseKey || null, warning };
  });
};
