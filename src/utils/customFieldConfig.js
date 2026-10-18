/**
 * @file customFieldConfig.js
 * @description Centralized Jira Custom Field resolution utility for Test Pulse Suite.
 *
 * Why this module exists:
 * Jira Cloud instances assign numeric identifiers (e.g., `customfield_10534`) to custom fields
 * when they are created. While El Puerto de Liverpool's production site uses a known set of
 * custom field IDs, hardcoding those IDs across dozens of JQL queries and resolvers makes the
 * codebase harder to maintain and less portable across Jira projects or environments.
 *
 * This module centralizes all default custom field IDs in one place (`DEFAULT_CUSTOM_FIELDS`)
 * and provides helper functions that merge project-level configuration (`testops-config`)
 * or runtime payload overrides with the safe production defaults.
 */

export const DEFAULT_CUSTOM_FIELDS = Object.freeze({
  // Test Case & Test Run classification fields
  executionType: 'customfield_10534',      // Tipo de Ejecución (Manual / Automatizada)
  testLevel: 'customfield_10530',          // Nivel de Prueba (UAT, SIT, Regresión, etc.)
  testType: 'customfield_10535',           // Tipo de Prueba (Funcional, No Funcional, etc.)

  // Default Test Case step/snapshot custom fields
  preconditionDefault: 'customfield_10568', // Precondiciones
  stepsDefault: 'customfield_10569',        // Pasos de Prueba
  expectedDefault: 'customfield_10570',     // Resultados Esperados

  // Agile hierarchy linkage
  epicLink: 'customfield_10014',            // Classic Jira Epic Link field

  // Defect / Bug tracking custom fields
  bugSeverity: 'customfield_10238',         // *Severity / Severidad del Defecto
  bugEstimatedDate: 'customfield_10763'     // Fecha Estimada de Solución
});

/**
 * Resolves the active custom field IDs by merging defaults with any project-level
 * configuration (`testops-config`) and per-request payload overrides.
 *
 * @param {Object} [config={}] - Project configuration object from `testops-config`.
 * @param {Object} [overrides={}] - Optional per-invocation field ID overrides.
 * @returns {Object} Resolved custom field ID map.
 */
export function resolveCustomFields(config = {}, overrides = {}) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};

  return {
    executionType:
      safeOverrides.executionTypeFieldId ||
      safeConfig.executionTypeFieldId ||
      DEFAULT_CUSTOM_FIELDS.executionType,
    testLevel:
      safeOverrides.testLevelFieldId ||
      safeConfig.testLevelFieldId ||
      DEFAULT_CUSTOM_FIELDS.testLevel,
    testType:
      safeOverrides.testTypeFieldId ||
      safeConfig.testTypeFieldId ||
      DEFAULT_CUSTOM_FIELDS.testType,
    preconditionDefault:
      safeOverrides.preconditionFieldId ||
      safeConfig.preconditionFieldId ||
      DEFAULT_CUSTOM_FIELDS.preconditionDefault,
    stepsDefault:
      safeOverrides.stepsFieldId ||
      safeConfig.stepsFieldId ||
      DEFAULT_CUSTOM_FIELDS.stepsDefault,
    expectedDefault:
      safeOverrides.expectedFieldId ||
      safeConfig.expectedFieldId ||
      DEFAULT_CUSTOM_FIELDS.expectedDefault,
    epicLink:
      safeOverrides.epicLinkFieldId ||
      safeConfig.epicLinkFieldId ||
      DEFAULT_CUSTOM_FIELDS.epicLink,
    bugSeverity:
      safeOverrides.bugSeverityFieldId ||
      safeConfig.bugSeverityFieldId ||
      DEFAULT_CUSTOM_FIELDS.bugSeverity,
    bugEstimatedDate:
      safeOverrides.bugEstimatedDateFieldId ||
      safeConfig.bugEstimatedDateFieldId ||
      DEFAULT_CUSTOM_FIELDS.bugEstimatedDate
  };
}

/**
 * Deduplicates an array of Jira field names while preserving order and filtering out empty values.
 *
 * @param {Array<string>} fields - Array of field identifiers.
 * @returns {Array<string>} Deduplicated field identifiers.
 */
function uniqueFields(fields) {
  return Array.from(new Set((fields || []).filter(Boolean)));
}

/**
 * Builds the default safe list of fields to request from `/rest/api/3/search/jql`
 * when a caller passes `'*all'`.
 *
 * @param {Object} [config={}] - Optional project configuration.
 * @returns {Array<string>} List of safe Jira field keys.
 */
export function getDefaultJqlSafeFields(config = {}) {
  const cf = resolveCustomFields(config);
  return uniqueFields([
    'summary',
    'status',
    'created',
    'issuetype',
    'priority',
    'assignee',
    'reporter',
    'resolution',
    cf.executionType,
    cf.testLevel,
    cf.testType,
    cf.preconditionDefault,
    cf.stepsDefault,
    cf.expectedDefault
  ]);
}

/**
 * Builds the field list required when querying Test Cases in the Repository module.
 *
 * @param {Object} [config={}] - Project configuration object.
 * @param {Object} [payload={}] - Resolver payload that may include runtime field IDs.
 * @returns {Array<string>} Deduplicated array of Jira field keys.
 */
export function getTestCaseJqlFields(config = {}, payload = {}) {
  const cf = resolveCustomFields(config, payload);
  return uniqueFields([
    'summary',
    'status',
    'created',
    'issuelinks',
    'issuetype',
    'priority',
    'labels',
    'parent',
    cf.epicLink,
    DEFAULT_CUSTOM_FIELDS.epicLink,
    cf.executionType,
    DEFAULT_CUSTOM_FIELDS.executionType,
    cf.testLevel,
    DEFAULT_CUSTOM_FIELDS.testLevel,
    cf.testType,
    DEFAULT_CUSTOM_FIELDS.testType,
    'reporter',
    'creator',
    'assignee'
  ]);
}

/**
 * Builds the field list required when querying Test Run candidates or cycle execution summaries.
 *
 * @param {Object} [config={}] - Optional project configuration.
 * @returns {Array<string>} Deduplicated array of Jira field keys.
 */
export function getRunCandidateJqlFields(config = {}) {
  const cf = resolveCustomFields(config);
  return uniqueFields([
    'summary',
    'status',
    'description',
    'assignee',
    'created',
    'issuelinks',
    'attachment',
    'priority',
    cf.executionType,
    DEFAULT_CUSTOM_FIELDS.executionType,
    cf.testLevel,
    DEFAULT_CUSTOM_FIELDS.testLevel
  ]);
}

/**
 * Builds the field list required when querying Requirements, Stories, and Epics.
 *
 * @param {Object} [config={}] - Optional project configuration.
 * @returns {Array<string>} Deduplicated array of Jira field keys.
 */
export function getRequirementJqlFields(config = {}) {
  const cf = resolveCustomFields(config);
  return uniqueFields([
    'summary',
    'issuetype',
    'parent',
    cf.epicLink,
    DEFAULT_CUSTOM_FIELDS.epicLink,
    'status',
    'issuelinks'
  ]);
}

/**
 * Extracts the human-readable execution type ('Manual', 'Automatizada', etc.)
 * from a Jira issue's `fields` object using the configured or default custom field IDs.
 *
 * @param {Object} [fields={}] - The `issue.fields` object returned by Jira REST API.
 * @param {Object} [config={}] - Optional project configuration.
 * @param {string} [fallback='Manual'] - Fallback value if no custom field is populated.
 * @returns {string} Resolved execution type label.
 */
export function extractExecutionTypeFromFields(fields = {}, config = {}, fallback = 'Manual') {
  if (!fields || typeof fields !== 'object') return fallback;
  const cf = resolveCustomFields(config);
  const candidateKeys = uniqueFields([
    cf.executionType,
    DEFAULT_CUSTOM_FIELDS.executionType,
    cf.testLevel,
    DEFAULT_CUSTOM_FIELDS.testLevel
  ]);

  for (const key of candidateKeys) {
    const rawVal = fields[key];
    if (!rawVal) continue;
    if (Array.isArray(rawVal) && rawVal.length > 0) {
      const first = rawVal[0];
      return (typeof first === 'object' && first !== null)
        ? (first.value || first.name || String(first))
        : String(first);
    }
    if (typeof rawVal === 'object') {
      return rawVal.value || rawVal.name || fallback;
    }
    return String(rawVal);
  }

  return fallback;
}
