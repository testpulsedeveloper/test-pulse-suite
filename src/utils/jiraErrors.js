/**
 * @file jiraErrors.js
 * @description Turns raw Jira REST error bodies into short, user-facing messages.
 *
 * Jira error responses can contain HTML pages, stack traces from proxies or very long
 * payloads. Returning them verbatim to the browser leaks internal details and produces
 * unreadable notifications. Jira's JSON errors, however, carry useful messages such as
 * "Field 'customfield_10031' cannot be set. It is not on the appropriate screen", which
 * testers need to fix their configuration. This helper keeps only those messages.
 */

const MAX_ERROR_LENGTH = 300;

/**
 * Extracts the human-readable part of a Jira error body.
 *
 * @param {string} rawText - Response body returned by Jira (`await res.text()`).
 * @returns {string} Short message safe to display (never longer than 300 chars).
 */
export function summarizeJiraError(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) return 'Sin detalle de Jira.';
  try {
    const data = JSON.parse(text);
    const parts = [];
    if (Array.isArray(data?.errorMessages)) parts.push(...data.errorMessages);
    if (data?.errors && typeof data.errors === 'object') {
      for (const [field, msg] of Object.entries(data.errors)) parts.push(`${field}: ${msg}`);
    }
    if (typeof data?.message === 'string') parts.push(data.message);
    const joined = parts.filter(p => typeof p === 'string' && p.trim()).join(' | ');
    if (joined) return joined.slice(0, MAX_ERROR_LENGTH);
  } catch (_) {
    // Not JSON (HTML error page, proxy text…): fall through to the generic message.
  }
  return 'Jira devolvió un error sin detalle legible (revisa los logs de la app).';
}
