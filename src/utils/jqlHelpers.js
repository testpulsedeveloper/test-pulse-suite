/**
 * @file jqlHelpers.js
 * @description Safe construction of JQL string literals.
 *
 * Many resolvers build JQL from values that arrive in the browser payload (project IDs,
 * cycle IDs, issue type names from the project configuration…). Interpolating them raw,
 * e.g. `project = "${projectId}"`, lets a crafted value close the quote and append its own
 * clauses (JQL injection). `jqlQuote` always returns a single, correctly escaped JQL string
 * literal, so every legitimate value keeps working exactly as before.
 */

/**
 * Wraps a value in double quotes for JQL, escaping backslashes and double quotes.
 * Line breaks are collapsed to spaces because JQL string literals cannot contain them.
 *
 * @example jqlQuote('Test Case') → "Test Case"
 * @example jqlQuote('10001" OR project is not EMPTY') → "10001\" OR project is not EMPTY"
 *
 * @param {unknown} value - Raw value to embed in a JQL query.
 * @returns {string} JQL string literal, including the surrounding quotes.
 */
export function jqlQuote(value) {
  const str = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `"${str}"`;
}
