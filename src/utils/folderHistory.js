/**
 * @file folderHistory.js
 * @description Server-side history of the folder tree of each project (v4.36.0).
 *
 * Why this exists
 * ---------------
 * The folder tree lives in ONE Jira project property (`testops-folders`), and Jira keeps no
 * history of property values. On 2026-11-19 a bug wrote a one-folder list over the tree of CUQ,
 * and there was no copy to go back to. Now, before every change to the tree, the version being
 * replaced is saved in Forge Key-Value Storage (the app's own storage, not visible in Jira), so a
 * project admin can bring any of the last versions back from Settings.
 *
 * Storage layout
 * --------------
 *   folderSnap:<PROJECT>:<savedAt padded>-<rand>  →  { projectId, savedAt, by, op, count, folders }
 * One key per version (a big tree times 30 versions would not fit in a single 240 KiB value).
 * Only the Atlassian accountId of who made the change is stored, never names.
 *
 * Retention: the newest MAX_SNAPSHOTS versions per project. To keep 30 versions meaningful when
 * someone drags 20 folders in a row, a new version is NOT saved when the last one is younger
 * than COALESCE_MS, unless the change removes folders (those always get their own version).
 */

import { kvs as storage, WhereConditions } from '@forge/kvs';

export const MAX_SNAPSHOTS = 30;
export const COALESCE_MS = 5 * 60 * 1000;
// Forge KVS values may not exceed 240 KiB; keep a margin.
const MAX_SNAPSHOT_BYTES = 230000;

/** Normalized project part of the key (ids and keys of Jira projects are [A-Za-z0-9_]). */
const projectPart = (projectId) => String(projectId ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');

/** Prefix shared by every version of one project. */
export const snapshotPrefix = (projectId) => `folderSnap:${projectPart(projectId)}:`;

/** Key of a new version; the zero-padded time keeps keys sortable, the suffix avoids clashes. */
const snapshotKey = (projectId, savedAt) =>
  `${snapshotPrefix(projectId)}${String(savedAt).padStart(15, '0')}-${Math.random().toString(36).slice(2, 6)}`;

/** A snapshot id sent by the browser must belong to the project asked for. */
export const isSnapshotOf = (projectId, snapshotId) =>
  typeof snapshotId === 'string' && snapshotId.startsWith(snapshotPrefix(projectId)) && /^[A-Za-z0-9:_-]+$/.test(snapshotId);

/**
 * Every stored version of a project, newest first.
 *
 * @param {string} projectId
 * @param {boolean} [withFolders=false] - false = only the summary (cheaper to send to the page).
 * @returns {Promise<Array<{id: string, savedAt: number, by: (string|null), op: string, count: number, folders?: Array}>>}
 */
export async function listFolderSnapshots(projectId, withFolders = false) {
  const prefix = snapshotPrefix(projectId);
  const found = [];
  let cursor;
  let pages = 0;
  do {
    let query = storage.query().where('key', WhereConditions.beginsWith(prefix)).limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const item of page?.results || []) {
      const value = item?.value || {};
      found.push({
        id: String(item.key),
        savedAt: Number(value.savedAt) || 0,
        by: value.by || null,
        op: String(value.op || ''),
        count: Number(value.count) || 0,
        ...(withFolders ? { folders: Array.isArray(value.folders) ? value.folders : [] } : {})
      });
    }
    cursor = page?.nextCursor;
    pages++;
  } while (cursor && pages < 20);
  return found.sort((a, b) => b.savedAt - a.savedAt);
}

/** One stored version with its folders, or null when it does not exist. */
export async function getFolderSnapshot(projectId, snapshotId) {
  if (!isSnapshotOf(projectId, snapshotId)) return null;
  const value = await storage.get(snapshotId);
  if (!value || !Array.isArray(value.folders)) return null;
  return { id: snapshotId, savedAt: value.savedAt, by: value.by || null, op: value.op, count: value.folders.length, folders: value.folders };
}

/**
 * Saves `folders` (the tree ABOUT TO BE REPLACED) as a new version, then trims the oldest.
 * Never throws: losing a history entry must not block the user's change; it is only logged.
 *
 * @param {string} projectId
 * @param {Array<Object>} folders - The tree as it was before the change.
 * @param {{op: string, by: (string|null), removesFolders: boolean, now?: number}} info
 * @returns {Promise<boolean>} true when a version was written.
 */
export async function saveFolderSnapshot(projectId, folders, { op, by, removesFolders, now = Date.now() }) {
  try {
    const list = Array.isArray(folders) ? folders : [];
    // An empty tree is not worth keeping (there is nothing to go back to).
    if (list.length === 0) return false;
    const existing = await listFolderSnapshots(projectId);
    const latest = existing[0];
    if (!removesFolders && latest && now - latest.savedAt < COALESCE_MS) return false;

    const value = { projectId: String(projectId), savedAt: now, by: by || null, op: String(op || ''), count: list.length, folders: list };
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SNAPSHOT_BYTES) {
      console.warn(`[folders] history skipped project=${projectId}: tree too big (${list.length} folders)`);
      return false;
    }
    await storage.set(snapshotKey(projectId, now), value);

    // Keep only the newest MAX_SNAPSHOTS (the one just written counts).
    const extra = existing.slice(MAX_SNAPSHOTS - 1);
    for (const old of extra) await storage.delete(old.id);
    return true;
  } catch (e) {
    console.warn(`[folders] history save failed project=${projectId}: ${e?.message}`);
    return false;
  }
}
