/**
 * envDowntimeResolvers.js — "Ambiente no disponible" (Test Pulse 5.0, v4.42.0).
 *
 * Lets any user of the project report that a test environment (or one of its components)
 * is down, and mark it as restored later. The whole team sees the open reports in
 * Ejecución. Reports are stored per project in Forge KVS (see utils/envDowntime.js); they
 * never change the status of a test case.
 *
 * Authorization: reading and writing require access to THAT project (Jira "Browse
 * projects" or a Test Pulse superuser), checked with `canAccessProject`. KVS is only
 * reachable as the app, so this check is what keeps one project's data from another.
 */
import { kvs as storage } from '@forge/kvs';
import { canAccessProject, AuthorizationError, normalizeProjectRef } from '../utils/authz.js';
import { storageKey, buildEvent, addEvent, closeEvent } from '../utils/envDowntime.js';

/** Throws FORBIDDEN unless the current user can use Test Pulse in `projectId`. */
const requireProjectAccess = async (projectId, context) => {
  const ref = normalizeProjectRef(projectId);
  if (!ref || !(await canAccessProject(ref, context))) {
    throw new AuthorizationError('FORBIDDEN', 'No tienes acceso a este proyecto.');
  }
  return ref;
};

const readEvents = async (projectId) => {
  const value = await storage.get(storageKey(projectId));
  return Array.isArray(value) ? value : [];
};

/**
 * Registers the environment downtime resolvers.
 * @param {import('@forge/resolver').default} resolver
 */
export function registerEnvDowntimeResolvers(resolver) {
  // Open reports plus the latest closed ones (for the history in Configuración and metrics).
  resolver.define('getEnvDowntime', async ({ payload, context }) => {
    const projectId = await requireProjectAccess(payload?.projectId, context);
    const events = await readEvents(projectId);
    return { events };
  });

  resolver.define('reportEnvDowntime', async ({ payload, context }) => {
    const projectId = await requireProjectAccess(payload?.projectId, context);
    const event = buildEvent(payload || {}, context?.accountId);
    // Read-modify-write. Two reports in the same instant are very unlikely; if it happens,
    // the later write wins and the duplicate-check simply sees the latest state.
    const next = addEvent(await readEvents(projectId), event);
    await storage.set(storageKey(projectId), next);
    // Audit: ids only, no names.
    console.log(`[envDowntime] report project=${projectId} env=${event.envId} component=${event.component ? 'yes' : 'no'} ticket=${event.ticket ? 'yes' : 'no'} by=${event.startedBy || 'unknown'}`);
    return { event, events: next };
  });

  resolver.define('resolveEnvDowntime', async ({ payload, context }) => {
    const projectId = await requireProjectAccess(payload?.projectId, context);
    const next = closeEvent(await readEvents(projectId), String(payload?.id || ''), context?.accountId);
    await storage.set(storageKey(projectId), next);
    console.log(`[envDowntime] restored project=${projectId} id=${payload?.id} by=${context?.accountId || 'unknown'}`);
    return { events: next };
  });
}
