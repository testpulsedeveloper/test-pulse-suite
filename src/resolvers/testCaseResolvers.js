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
 *   - getTestCaseForEdit → the current values of one Test Case, ready for the edit form.
 *   - saveTestCase       → creates a Test Case, or updates only the fields that changed, and
 *                          keeps its link to the requirement ("is tested by") in sync.
 *
 * Security: every request to Jira is made AS THE USER (`api.asUser()`), so Jira itself decides
 * whether that person may see, create or edit the issue. The central wrapper in index.js has
 * already checked that the user belongs to `payload.projectId`.
 *
 * Cost: reading for edit = 1 request. Saving = 1 request, plus 1 or 2 only when the requirement
 * changed. No searches.
 */

import api, { route } from '@forge/api';
import { resolveCustomFields } from '../utils/customFieldConfig.js';
import { summarizeJiraError } from '../utils/jiraErrors.js';
import { normalizeIssueRef, normalizeProjectRef } from '../utils/authz.js';
import { adfToPlainText, buildTestCaseFields } from '../utils/testCaseText.js';

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
 * @returns {{optionId: string, multiple: boolean}}
 */
const currentOption = (value) => {
  if (Array.isArray(value)) return { optionId: String(value[0]?.id ?? ''), multiple: true };
  if (value && typeof value === 'object') return { optionId: String(value.id ?? ''), multiple: false };
  return { optionId: '', multiple: false };
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
  // Current values of a Test Case for the edit form.
  resolver.define('getTestCaseForEdit', async ({ payload }) => {
    const caseRef = normalizeIssueRef(payload?.caseId);
    if (!caseRef) return { error: 'Caso de prueba inválido.' };
    const fieldIds = resolveCustomFields(payload?.config);
    const fieldList = ['summary', 'description', 'priority', 'issuelinks', fieldIds.testLevel, fieldIds.testType, fieldIds.executionType].join(',');

    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${caseRef}?fields=${fieldList}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { error: await jiraFailure(response, 'leer') };
    const issue = await response.json();
    const fields = issue.fields || {};
    const description = adfToPlainText(fields.description);

    return {
      id: String(issue.id),
      key: issue.key,
      summary: String(fields.summary || ''),
      descriptionText: description.text,
      // True when the description has tables, images, links… that the text box cannot keep.
      hasRichDescription: description.hasRichContent,
      priorityId: String(fields.priority?.id ?? ''),
      testLevel: currentOption(fields[fieldIds.testLevel]),
      testType: currentOption(fields[fieldIds.testType]),
      executionType: currentOption(fields[fieldIds.executionType]),
      // Every link of the case; the form picks the one that points to its requirement.
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

    // Requirement link ("is tested by"). `requirement` is only sent when it changed:
    //   key        → new requirement ('' = none)
    //   removeLinkId → link to the previous requirement, to be removed
    //   linkType   → name of the Jira link type configured for requirements
    let warning = null;
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
