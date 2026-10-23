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
 * @param {string} projectId - Jira project ID or key.
 * @returns {Promise<Array<Object>>} Array of folder objects (`{ id, name, parentId }`).
 */
export const getProjectFolders = async (projectId) => {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`);
    if (response.status === 404 || !response.ok) return [];
    const data = await response.json();
    return data.value || [];
  } catch (e) {
    console.error('Error getProjectFolders:', e);
    return [];
  }
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
 * Registers all folder CRUD resolvers on the shared Forge Resolver instance.
 *
 * @param {import('@forge/resolver').default} resolver - Forge Resolver instance.
 */
export function registerFolderResolvers(resolver) {
  resolver.define('getFolders', async ({ payload }) => {
    const { projectId } = payload;
    return await getProjectFolders(projectId);
  });

  resolver.define('createFolder', async ({ payload }) => {
    const { projectId, name, parentId } = payload;
    // Any user with project access can create folders
    await verifyProjectBrowseAccess(projectId);
    const folders = await getProjectFolders(projectId);
    const newFolder = { id: `folder-${Date.now()}`, name, parentId: parentId || null };
    folders.push(newFolder);
    await setProjectFolders(projectId, folders);
    return folders;
  });

  resolver.define('updateFolder', async ({ payload }) => {
    const { projectId, folderId, newName } = payload;
    // Any user with project access can rename folders
    await verifyProjectBrowseAccess(projectId);
    const folders = await getProjectFolders(projectId);
    const updatedFolders = folders.map(f => (f.id === folderId ? { ...f, name: newName } : f));
    await setProjectFolders(projectId, updatedFolders);
    return updatedFolders;
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
    await setProjectFolders(projectId, updatedFolders);
    return updatedFolders;
  });
}

