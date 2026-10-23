/**
 * @file folderResolvers.js
 * @description Backend resolvers for Test Case Repository folder hierarchy management.
 *
 * Folders are stored per-project inside the `testops-folders` Jira Project Property.
 * Read access uses `.asApp()` so all users with project access can view the folder tree,
 * while write and delete operations use `.asUser()` (with explicit `ADMINISTER_PROJECTS`
 * permission verification on deletion).
 */

import api, { route } from '@forge/api';
import { requireProjectAdmin } from '../utils/authz.js';

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
 *
 * @param {string} projectId - Jira project ID or key.
 * @param {Array<Object>} data - Complete array of folder objects to store.
 * @returns {Promise<void>}
 */
export const setProjectFolders = async (projectId, data) => {
  await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
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
    const folders = await getProjectFolders(projectId);
    const newFolder = { id: `folder-${Date.now()}`, name, parentId: parentId || null };
    folders.push(newFolder);
    await setProjectFolders(projectId, folders);
    return folders;
  });

  resolver.define('updateFolder', async ({ payload }) => {
    const { projectId, folderId, newName } = payload;
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
