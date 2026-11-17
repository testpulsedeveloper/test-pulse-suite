/**
 * @file lifecycleEditors.js
 * @description Rules for WHO may edit the "Lifecycle" module (v4.19.0).
 *
 * Everybody who can use Test Pulse in a project can SEE its lifecycle (phases, deliverables,
 * findings). Only two kinds of people can CHANGE it:
 *   1. Administrators of the project and Test Pulse superusers (always).
 *   2. The people a project administrator picked in Settings → "Editores de Lifecycle".
 *
 * That list is stored per project in Forge storage (key `lifecycleEditors_<projectId>`), so it
 * does not depend on a Jira group existing.
 *
 * This file has no imports so it can be unit-tested with plain Node (tests/lifecycle.test.js).
 */

// v4.24.0: the team each editor belongs to. Findings reports are grouped by these teams in
// Lifecycle; '' means "no team yet". The labels shown to people live in the UI.
export const LIFECYCLE_TEAMS = ['dev', 'qa', 'uat'];

/** Returns the team id when it is one of LIFECYCLE_TEAMS, otherwise ''. */
export const cleanLifecycleTeam = (value) => {
  const team = String(value || '').trim().toLowerCase();
  return LIFECYCLE_TEAMS.includes(team) ? team : '';
};

/**
 * Team of a person according to the stored editors list ('' when not listed or without team).
 *
 * @param {Array<{accountId: string, team?: string}>} editors
 * @param {string} accountId
 * @returns {string}
 */
export function teamOfEditor(editors, accountId) {
  if (!accountId) return '';
  const editor = (Array.isArray(editors) ? editors : []).find(item => item?.accountId === accountId);
  return cleanLifecycleTeam(editor?.team);
}

// Upper bound of the list: a QA team, not a whole company.
export const MAX_LIFECYCLE_EDITORS = 50;

// v4.25.0: people per team (Dev, QA, UAT). Separate from the editors list: being in a team
// does NOT allow editing Lifecycle; it only says which team the reports, epics and stories of
// that person belong to (for stories and epics, the Jira reporter is the person).
export const MAX_LIFECYCLE_TEAM_MEMBERS = 300;

/** Storage key of the team members list of one project. */
export const lifecycleTeamsKey = (projectId) => `lifecycleTeams_${projectId}`;

/**
 * Cleans the team members list sent by the browser: same rules as the editors list, and every
 * member must have one of the teams.
 *
 * @param {Array<{accountId: string, displayName?: string, avatarUrl?: string, team: string}>} rawMembers
 * @returns {Array<{accountId: string, displayName: string, avatarUrl: string, team: string}>}
 */
export function sanitizeLifecycleTeamMembers(rawMembers) {
  return sanitizeLifecycleEditors(rawMembers, MAX_LIFECYCLE_TEAM_MEMBERS).filter(member => member.team);
}

/**
 * Team of every known person: the team lists first, then (for teams assigned in v4.24.0) the
 * team stored on the editors list.
 *
 * @param {Array} members - Team members list.
 * @param {Array} editors - Editors list.
 * @returns {Array<{accountId: string, displayName: string, team: string}>}
 */
export function mergeLifecyclePeople(members, editors) {
  const byId = new Map();
  for (const editor of Array.isArray(editors) ? editors : []) {
    if (editor?.accountId) byId.set(editor.accountId, { accountId: editor.accountId, displayName: editor.displayName || editor.accountId, team: cleanLifecycleTeam(editor.team) });
  }
  for (const member of Array.isArray(members) ? members : []) {
    const team = cleanLifecycleTeam(member?.team);
    if (!member?.accountId || !team) continue;
    byId.set(member.accountId, { accountId: member.accountId, displayName: member.displayName || member.accountId, team });
  }
  return [...byId.values()];
}

/** Storage key of the editors list of one project. */
export const lifecycleEditorsKey = (projectId) => `lifecycleEditors_${projectId}`;

// Atlassian account ids look like "5b10ac8d82e05b22cc7d4ef5" or "712020:uuid".
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * Cleans the list of editors sent by the browser before it is stored: only valid account ids,
 * no duplicates, bounded texts, and only https avatar URLs.
 *
 * @param {Array<{accountId: string, displayName?: string, avatarUrl?: string}>} rawEditors
 * @returns {Array<{accountId: string, displayName: string, avatarUrl: string, team: string}>}
 */
export function sanitizeLifecycleEditors(rawEditors, max = MAX_LIFECYCLE_EDITORS) {
  const seen = new Set();
  const editors = [];
  for (const raw of Array.isArray(rawEditors) ? rawEditors : []) {
    const accountId = String(raw?.accountId || '').trim();
    if (!ACCOUNT_ID_PATTERN.test(accountId) || seen.has(accountId)) continue;
    seen.add(accountId);
    const avatarUrl = String(raw?.avatarUrl || '').trim().slice(0, 500);
    editors.push({
      accountId,
      displayName: String(raw?.displayName || '').trim().slice(0, 120) || accountId,
      avatarUrl: /^https:\/\/[^\s]+$/i.test(avatarUrl) ? avatarUrl : '',
      // v4.24.0: Dev, QA or UAT, chosen by a project administrator in Settings.
      team: cleanLifecycleTeam(raw?.team)
    });
    if (editors.length >= max) break;
  }
  return editors;
}

/**
 * Is `accountId` in the stored list of editors?
 *
 * @param {Array<{accountId: string}>} editors - List as stored.
 * @param {string} accountId - Account id of the current user.
 * @returns {boolean}
 */
export function isListedLifecycleEditor(editors, accountId) {
  if (!accountId) return false;
  return (Array.isArray(editors) ? editors : []).some(editor => editor?.accountId === accountId);
}
