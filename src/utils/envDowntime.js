/**
 * envDowntime.js — pure helpers for "Ambiente no disponible" (Test Pulse 5.0, v4.42.0).
 *
 * A downtime EVENT records that a test environment (or one of its components) stopped
 * working, so the time lost is visible and does not count against the testers' progress.
 * Reporting an event NEVER changes the status of any test case.
 *
 * Events of one project are stored together in Forge KVS under `tp5-env-downtime:<projectId>`
 * as an array, newest first, capped at MAX_EVENTS so the value stays far below the 240 KiB
 * KVS limit (each event is ~300 bytes). Only Atlassian accountIds are stored, never names.
 *
 * Kept free of Forge imports so it can be unit tested with `node --test`.
 */

export const MAX_EVENTS = 300;
export const storageKey = (projectId) => `tp5-env-downtime:${String(projectId)}`;

// Jira issue key such as "INC-1234" or a URL; anything else is rejected to keep data clean.
const TICKET_KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;

/** Trims a value to a string of at most `max` characters ('' for empty/invalid input). */
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max);

/**
 * Validates and normalises the incident ticket. Accepts a Jira key or an https URL.
 * @returns {string} '' when not provided
 * @throws {Error} when provided but not valid
 */
export const normalizeTicket = (value) => {
  const t = clean(value, 300);
  if (!t) return '';
  if (TICKET_KEY.test(t.toUpperCase())) return t.toUpperCase();
  if (/^https:\/\/[^\s]+$/i.test(t)) return t;
  throw new Error('El ticket debe ser una clave de Jira (por ejemplo INC-1234) o un enlace https.');
};

/**
 * Builds a new event from the reporter's input.
 * @param {object} input { envId, envName, component, ticket, cycleId, note }
 * @param {string} accountId reporter
 * @param {Date} now
 */
export const buildEvent = (input, accountId, now = new Date()) => {
  const envId = clean(input?.envId, 120);
  const envName = clean(input?.envName, 120);
  if (!envId || !envName) throw new Error('Elige el ambiente que no está disponible.');
  return {
    id: `dt-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    envId,
    envName,
    // Empty component = the whole environment is down.
    component: clean(input?.component, 120),
    ticket: normalizeTicket(input?.ticket),
    cycleId: clean(input?.cycleId, 40),
    note: clean(input?.note, 500),
    startedAt: now.toISOString(),
    startedBy: clean(accountId, 128),
    endedAt: null,
    endedBy: null
  };
};

/** Adds an event (newest first), refusing a duplicate open event for the same env + component. */
export const addEvent = (events, event) => {
  const list = Array.isArray(events) ? events : [];
  const dup = list.find(e => !e.endedAt && e.envId === event.envId && (e.component || '') === (event.component || ''));
  if (dup) {
    const what = event.component ? `${event.envName} · ${event.component}` : event.envName;
    throw new Error(`Ya hay un reporte abierto para ${what}. Márcalo como restablecido cuando vuelva.`);
  }
  return [event, ...list].slice(0, MAX_EVENTS);
};

/** Closes an open event. Returns the new list; throws when the event doesn't exist or is closed. */
export const closeEvent = (events, id, accountId, now = new Date()) => {
  const list = Array.isArray(events) ? events : [];
  const idx = list.findIndex(e => e.id === id);
  if (idx < 0) throw new Error('El reporte ya no existe.');
  if (list[idx].endedAt) throw new Error('Este reporte ya estaba marcado como restablecido.');
  const next = list.slice();
  next[idx] = { ...list[idx], endedAt: now.toISOString(), endedBy: clean(accountId, 128) };
  return next;
};

/**
 * Hours of downtime per environment inside [from, to] (open events count until `to`).
 * Overlapping events of the same environment are merged so time isn't counted twice.
 * @returns {Object<string, number>} envId → hours (one decimal)
 */
export const downtimeHoursByEnv = (events, from, to) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const byEnv = {};
  (Array.isArray(events) ? events : []).forEach(e => {
    const s = Math.max(new Date(e.startedAt).getTime(), start);
    const f = Math.min(e.endedAt ? new Date(e.endedAt).getTime() : end, end);
    if (Number.isFinite(s) && Number.isFinite(f) && f > s) (byEnv[e.envId] = byEnv[e.envId] || []).push([s, f]);
  });
  const out = {};
  Object.entries(byEnv).forEach(([envId, ranges]) => {
    ranges.sort((a, b) => a[0] - b[0]);
    let total = 0; let [cs, cf] = ranges[0];
    for (const [s, f] of ranges.slice(1)) {
      if (s <= cf) cf = Math.max(cf, f);
      else { total += cf - cs; cs = s; cf = f; }
    }
    total += cf - cs;
    out[envId] = Math.round((total / 3600000) * 10) / 10;
  });
  return out;
};
