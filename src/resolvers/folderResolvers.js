/**
 * @file folderResolvers.js
 * @description Backend resolvers for Test Case Repository folder hierarchy management.
 *
 * Folders are stored per-project inside the `testops-folders` Jira Project Property.
 * Read and write access to the project property uses `.asApp()` after verifying user
 * permissions via `.asUser()` because Jira restricts direct `PUT /rest/api/3/project/{id}/properties/{key}`
 * calls to Project Administrators (`ADMINISTER_PROJECTS`).
 * - Creating and renaming folders is permitted for all project members (`BROWSE_PROJECTS`).
 * - Deleting folders is strictly restricted to Project Administrators (`ADMINISTER_PROJECTS`).
 */

import api, { route } from '@forge/api';
import { summarizeJiraError } from '../utils/jiraErrors.js';
import { requireProjectAdmin } from '../utils/authz.js';
import { saveFolderSnapshot, listFolderSnapshots, getFolderSnapshot } from '../utils/folderHistory.js';

/**
 * Verifies that the current user has permission to access the project (`BROWSE_PROJECTS`).
 * Required before using `.asApp()` to write project-level folder properties on behalf of non-admin users.
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<void>}
 */
const verifyProjectBrowseAccess = async (projectId) => {
  const permissionRes = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=BROWSE_PROJECTS`
  );
  if (permissionRes.ok) {
    const permissionData = await permissionRes.json();
    if (!permissionData?.permissions?.BROWSE_PROJECTS?.havePermission) {
      throw new Error('No tienes permisos de acceso al proyecto para crear o modificar carpetas.');
    }
  } else {
    throw new Error('No se pudieron verificar los permisos del usuario en el proyecto.');
  }
};

/**
 * Fetches the folder tree stored in the `testops-folders` Jira project property.
 *
 * v4.35.0 — STRICT read. Until v4.34.2 any failed answer (503, timeout…) was returned as an
 * empty list. Creating, renaming or moving a folder reads the list, changes it and writes it back
 * WHOLE, so on 2026-11-19, during a Jira outage, creating one folder in CUQ replaced the whole
 * tree with just that folder. Now only "the property does not exist" (404) means "no folders";
 * every other failure throws, so nothing is ever written on top of a list that was not read.
 *
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<Array<Object>>} Array of folder objects (`{ id, name, parentId }`).
 * @throws {Error} When Jira could not answer (the caller must not write anything then).
 */
export const getProjectFolders = async (projectId) => {
  let response;
  try {
    response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`);
  } catch (e) {
    console.error('[folders] read failed:', e?.message);
    throw new Error(FOLDERS_UNAVAILABLE_MESSAGE);
  }
  // A project that never had folders has no property yet: that is a real "no folders".
  if (response.status === 404) return [];
  if (!response.ok) {
    console.error(`[folders] read failed: HTTP ${response.status}`);
    throw new Error(FOLDERS_UNAVAILABLE_MESSAGE);
  }
  const data = await response.json();
  return Array.isArray(data?.value) ? data.value : [];
};

/** Shown when the folder tree cannot be read; contains the text the UI uses to detect outages. */
const FOLDERS_UNAVAILABLE_MESSAGE = 'Jira no está respondiendo y no se pudieron leer las carpetas. No se hizo ningún cambio; intenta de nuevo en un momento.';

/**
 * One log line per change of the tree, so a future loss can be traced: who (Atlassian
 * accountId only, never names), which project, what operation, and how many folders before and
 * after. Folder names are not logged.
 */
const logFolderChange = (op, projectId, context, before, after) => {
  console.log(`[folders] op=${op} project=${projectId} by=${context?.accountId || 'n/a'} before=${before} after=${after}`);
};

/** Ids Test Pulse generates for folders (`folder-<milliseconds>`); anything else is refused. */
const FOLDER_ID = /^folder-\d{10,16}$/;
const MAX_RESTORED_FOLDERS = 3000;

/**
 * Cleans a folder list coming from a browser copy before it is merged back (v4.35.0).
 * Only `{ id, name, parentId }` with a Test Pulse id and a non-empty name are kept.
 *
 * @param {Array<Object>} raw
 * @returns {Array<{id: string, name: string, parentId: (string|null)}>}
 */
export const sanitizeFolderBackup = (raw) => {
  const seen = new Set();
  const clean = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, MAX_RESTORED_FOLDERS) : []) {
    const id = String(item?.id ?? '');
    const name = String(item?.name ?? '').trim().slice(0, 200);
    if (!FOLDER_ID.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const parentId = item?.parentId && FOLDER_ID.test(String(item.parentId)) ? String(item.parentId) : null;
    clean.push({ id, name, parentId });
  }
  return clean;
};

/**
 * Puts back the folders of a browser copy that the stored tree no longer has (v4.35.0).
 * Folders already stored win (they may have been renamed or moved since the copy), so a restore
 * never undoes later work. A folder whose parent exists in neither list goes to the root, so it
 * is visible instead of hanging from a parent that does not exist.
 *
 * @param {Array<Object>} stored - Folders currently stored.
 * @param {Array<Object>} backup - Sanitized folders from the browser copy.
 * @returns {{folders: Array<Object>, added: number}}
 */
export const mergeFolderBackup = (stored, backup) => {
  const current = Array.isArray(stored) ? stored : [];
  const ids = new Set(current.map(f => String(f?.id)));
  const added = backup.filter(f => !ids.has(f.id));
  const merged = [...current, ...added];
  const all = new Set(merged.map(f => String(f?.id)));
  const folders = merged.map(f => (f?.parentId && !all.has(String(f.parentId)) ? { ...f, parentId: null } : f));
  return { folders, added: added.length };
};

/**
 * Persists the updated folder tree into the `testops-folders` Jira project property.
 * Uses `.asApp()` because Jira Cloud restricts project property PUT requests to `ADMINISTER_PROJECTS`
 * when called via `.asUser()`. Callers must verify appropriate user permissions before invoking this helper.
 *
 * @param {string} projectId - Jira project ID or key.
 * @param {Array<Object>} data - Complete array of folder objects to store.
 * @returns {Promise<void>}
 */
export const setProjectFolders = async (projectId, data) => {
  const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const errText = summarizeJiraError(await response.text().catch(() => ''));
    throw new Error(`No se pudo guardar la estructura de carpetas (HTTP ${response.status}): ${errText}`);
  }
};

/**
 * Folders of `before` that are missing from `after`, other than the ones the change is ALLOWED
 * to remove (v4.36.0 safety brake).
 *
 * @param {Array<Object>} before - Tree as read.
 * @param {Array<Object>} after - Tree about to be written.
 * @param {Iterable<string>} [allowed] - Ids the operation removes on purpose (a deleted subtree).
 * @returns {string[]} Ids that would be lost by mistake ([] = safe).
 */
export const unexpectedFolderLoss = (before, after, allowed = []) => {
  const kept = new Set((after || []).map(f => String(f?.id)));
  const ok = new Set([...allowed].map(String));
  return (before || []).map(f => String(f?.id)).filter(id => !kept.has(id) && !ok.has(id));
};

/**
 * The ONLY place that writes the folder tree (v4.36.0). In order:
 *   1. Safety brake: refuses the write when a folder would disappear without the operation
 *      meaning to remove it (create / rename / move / restore never remove anything; delete
 *      removes exactly the chosen subtree).
 *   2. History: saves the tree being replaced in Forge storage (see folderHistory.js).
 *   3. Writes the new tree to the Jira project property and logs one line.
 *
 * @param {Object} args
 * @param {string} args.projectId
 * @param {Array<Object>} args.before - Tree as read for this change.
 * @param {Array<Object>} args.after - Tree to write.
 * @param {string} args.op - create | rename | move | delete | restore | restoreVersion.
 * @param {Object} args.context - Resolver context (accountId of who changes it).
 * @param {Iterable<string>} [args.allowedRemovals] - Ids this operation removes on purpose.
 */
const writeFolderTree = async ({ projectId, before, after, op, context, allowedRemovals = [] }) => {
  const lost = unexpectedFolderLoss(before, after, allowedRemovals);
  if (lost.length > 0) {
    console.error(`[folders] blocked op=${op} project=${projectId} by=${context?.accountId || 'n/a'} would_lose=${lost.length} before=${before.length} after=${after.length}`);
    throw new Error('El cambio se canceló porque habría quitado carpetas que no se pidió quitar. No se modificó nada; recarga la vista e intenta de nuevo.');
  }
  const allowed = new Set([...allowedRemovals].map(String));
  const removesFolders = before.some(f => allowed.has(String(f?.id)));
  await saveFolderSnapshot(projectId, before, { op, by: context?.accountId || null, removesFolders });
  await setProjectFolders(projectId, after);
  logFolderChange(op, projectId, context, before.length, after.length);
};

/** Display name of each accountId (as the user, so Jira's privacy rules apply). */
const displayNames = async (accountIds) => {
  const names = {};
  await Promise.all([...new Set(accountIds.filter(Boolean))].slice(0, 20).map(async (accountId) => {
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
      if (res.ok) names[accountId] = (await res.json())?.displayName || null;
    } catch (e) {
      // A name is only a label; the version is listed without it.
    }
  }));
  return names;
};

/**
 * Registers all folder CRUD resolvers on the shared Forge Resolver instance.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
export function registerFolderResolvers(resolver) {
  resolver.define('getFolders', async ({ payload }) => {
    const { projectId } = payload;
    return await getProjectFolders(projectId);
  });

  resolver.define('createFolder', async ({ payload, context }) => {
    const { projectId, name, parentId } = payload;
    // Any user with project access can create folders
    await verifyProjectBrowseAccess(projectId);
    const folders = await getProjectFolders(projectId);
    const newFolder = { id: `folder-${Date.now()}`, name, parentId: parentId || null };
    const updated = [...folders, newFolder];
    await writeFolderTree({ projectId, before: folders, after: updated, op: 'create', context });
    return updated;
  });

  resolver.define('updateFolder', async ({ payload, context }) => {
    const { projectId, folderId, newName } = payload;
    // Any user with project access can rename folders
    await verifyProjectBrowseAccess(projectId);
    const folders = await getProjectFolders(projectId);
    const updatedFolders = folders.map(f => (f.id === folderId ? { ...f, name: newName } : f));
    await writeFolderTree({ projectId, before: folders, after: updatedFolders, op: 'rename', context });
    return updatedFolders;
  });

  /**
   * Moves a folder (with its subfolders and cases) under another folder, or to the root when
   * `newParentId` is null. Cases follow automatically: they point to their folder id, and only
   * the folder's `parentId` changes. Moving a folder into itself or one of its own subfolders
   * is refused, because it would cut that branch off the tree.
   */
  resolver.define('moveFolder', async ({ payload, context }) => {
    const { projectId, folderId } = payload || {};
    const newParentId = payload?.newParentId || null;
    // Any user with project access can reorganise folders (same rule as create/rename)
    await verifyProjectBrowseAccess(projectId);
    const folders = await getProjectFolders(projectId);
    const byId = new Map(folders.map(f => [String(f.id), f]));
    const moving = byId.get(String(folderId));
    if (!moving) throw new Error('La carpeta que intentas mover ya no existe.');
    if (newParentId && !byId.has(String(newParentId))) throw new Error('La carpeta destino ya no existe.');
    if (String(moving.parentId || '') === String(newParentId || '')) return folders;

    // Walk up from the destination: reaching the moving folder means it is a descendant.
    for (let cur = newParentId ? String(newParentId) : null, hops = 0; cur && hops <= folders.length; hops++) {
      if (cur === String(folderId)) {
        throw new Error('No puedes mover una carpeta dentro de sí misma ni de una de sus subcarpetas.');
      }
      cur = byId.get(cur)?.parentId ? String(byId.get(cur).parentId) : null;
    }

    const updated = folders.map(f => (String(f.id) === String(folderId) ? { ...f, parentId: newParentId } : f));
    await writeFolderTree({ projectId, before: folders, after: updated, op: 'move', context });
    return updated;
  });

  resolver.define('deleteFolder', async ({ payload, context }) => {
    const { projectId, folderId } = payload;
    // Only admins of this project (or Test Pulse superusers) may delete repository folders
    await requireProjectAdmin(projectId, context);

    const folders = await getProjectFolders(projectId);
    const toDelete = [folderId];
    let previousSize = 0;
    while (toDelete.length > previousSize) {
      previousSize = toDelete.length;
      folders.forEach(f => {
        if (toDelete.includes(f.parentId) && !toDelete.includes(f.id)) {
          toDelete.push(f.id);
        }
      });
    }
    const updatedFolders = folders.filter(f => !toDelete.includes(f.id));
    // Only the chosen folder and its subfolders may disappear.
    await writeFolderTree({ projectId, before: folders, after: updatedFolders, op: 'delete', context, allowedRemovals: toDelete });
    return updatedFolders;
  });

  /**
   * v4.35.0: puts back folders from a copy kept in the browser of a project admin (see
   * keepFoldersBackup in queryClient.js). Only folders missing from the stored tree are added;
   * nothing stored is changed or removed. Admins only, like deleting.
   */
  resolver.define('restoreFolders', async ({ payload, context }) => {
    const { projectId } = payload || {};
    await requireProjectAdmin(projectId, context);
    const backup = sanitizeFolderBackup(payload?.folders);
    if (backup.length === 0) throw new Error('La copia no tiene carpetas válidas para restaurar.');
    const folders = await getProjectFolders(projectId);
    const { folders: merged, added } = mergeFolderBackup(folders, backup);
    if (added > 0) await writeFolderTree({ projectId, before: folders, after: merged, op: 'restore', context });
    return { folders: merged, added };
  });

  /**
   * v4.36.0: versions of the folder tree saved before each change (newest first), for the
   * "Historial de carpetas" card in Settings. Admins only. Folders themselves are not sent.
   */
  resolver.define('getFolderHistory', async ({ payload, context }) => {
    const { projectId } = payload || {};
    await requireProjectAdmin(projectId, context);
    const versions = await listFolderSnapshots(projectId);
    const names = await displayNames(versions.map(v => v.by));
    return { versions: versions.map(v => ({ ...v, byName: names[v.by] || null })) };
  });

  /**
   * v4.36.0: brings a saved version back. Admins only.
   *   mode 'merge'   → adds the folders of that version that are missing now (nothing current is
   *                    changed or removed). The default.
   *   mode 'replace' → the tree becomes exactly that version (undoes later renames and moves,
   *                    and removes folders created after it).
   * Either way the current tree is saved to the history first, so the restore can be undone too.
   */
  resolver.define('restoreFolderVersion', async ({ payload, context }) => {
    const { projectId, snapshotId } = payload || {};
    const mode = payload?.mode === 'replace' ? 'replace' : 'merge';
    await requireProjectAdmin(projectId, context);
    const snapshot = await getFolderSnapshot(projectId, snapshotId);
    if (!snapshot) throw new Error('Esa versión del historial ya no existe. Recarga el historial.');
    const version = sanitizeFolderBackup(snapshot.folders);
    const folders = await getProjectFolders(projectId);
    if (mode === 'replace') {
      const keep = new Set(version.map(f => f.id));
      const removed = folders.map(f => String(f?.id)).filter(id => !keep.has(id));
      await writeFolderTree({ projectId, before: folders, after: version, op: 'restoreVersion', context, allowedRemovals: removed });
      return { folders: version, added: version.filter(f => !folders.some(c => String(c?.id) === f.id)).length, removed: removed.length };
    }
    const { folders: merged, added } = mergeFolderBackup(folders, version);
    if (added > 0) await writeFolderTree({ projectId, before: folders, after: merged, op: 'restoreVersion', context });
    return { folders: merged, added, removed: 0 };
  });
}

