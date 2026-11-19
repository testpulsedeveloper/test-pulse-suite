/**
 * @file folders.test.js
 * @description Folder drag & drop (v4.16.0): moveFolder keeps the tree valid, and the Design
 * selection actions no longer live in a floating bar.
 * `@forge/api` is replaced with a fake Jira holding the `testops-folders` project property.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let stored = [];
// v4.35.0: when set, reading the folder property answers with this HTTP status (Jira outage),
// or throws when it is 'throw'. `missing` = the property does not exist yet (404).
let readFailure = null;
let missing = false;
let writes = 0;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const handle = async (p, init = {}) => {
  if (p.includes('/mypermissions')) {
    // Grants every permission asked for (BROWSE_PROJECTS, ADMINISTER_PROJECTS…).
    const keys = (new URL(p, 'https://jira.test').searchParams.get('permissions') || '').split(',');
    return json({ permissions: Object.fromEntries(keys.map(k => [k, { havePermission: true }])) });
  }
  if (p.includes('/properties/testops-folders')) {
    if (init.method === 'PUT') { writes++; stored = JSON.parse(init.body); missing = false; return json({}, 200); }
    if (readFailure === 'throw') throw new Error('connect ETIMEDOUT');
    if (readFailure) return json({ errorMessages: ['Service Unavailable'] }, readFailure);
    if (missing) return json({ errorMessages: ['not found'] }, 404);
    return json({ value: stored });
  }
  return json({}, 404);
};
const route = (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '');
// v4.36.0: in-memory Forge KVS with the query().where(beginsWith).limit().cursor().getMany() API,
// for the folder history.
const kvStore = new Map();
const kvs = {
  get: async (k) => kvStore.get(k),
  set: async (k, v) => { kvStore.set(k, JSON.parse(JSON.stringify(v))); },
  delete: async (k) => { kvStore.delete(k); },
  query: () => {
    let prefix = '';
    let limit = 20;
    let start = 0;
    const q = {
      where: (_field, cond) => { prefix = cond.prefix; return q; },
      limit: (n) => { limit = n; return q; },
      cursor: (c) => { start = Number(c) || 0; return q; },
      getMany: async () => {
        const keys = [...kvStore.keys()].filter(k => k.startsWith(prefix)).sort();
        const slice = keys.slice(start, start + limit);
        return { results: slice.map(key => ({ key, value: kvStore.get(key) })), nextCursor: start + limit < keys.length ? String(start + limit) : undefined };
      }
    };
    return q;
  }
};
mock.module('@forge/kvs', { namedExports: { kvs, WhereConditions: { beginsWith: (prefix) => ({ prefix }) } } });

mock.module('@forge/api', {
  defaultExport: { asUser: () => ({ requestJira: handle }), asApp: () => ({ requestJira: handle }) },
  namedExports: { route }
});

const { registerFolderResolvers, sanitizeFolderBackup, mergeFolderBackup, unexpectedFolderLoss } = await import('../src/resolvers/folderResolvers.js');
const history = await import('../src/utils/folderHistory.js');
const defs = {};
registerFolderResolvers({ define: (name, fn) => { defs[name] = fn; } });
const move = (folderId, newParentId) => defs.moveFolder({ payload: { projectId: '10010', folderId, newParentId } });

const TREE = [
  { id: 'a', name: 'Boutiques', parentId: null },
  { id: 'b', name: 'Banana Republic', parentId: 'a' },
  { id: 'c', name: 'QA DEV', parentId: 'b' },
  { id: 'd', name: 'Duplicados', parentId: null }
];

test('a folder moves under another folder and back to the root', async () => {
  stored = TREE.map(f => ({ ...f }));
  let res = await move('d', 'c');
  assert.equal(res.find(f => f.id === 'd').parentId, 'c');
  res = await move('d', null);
  assert.equal(res.find(f => f.id === 'd').parentId, null);
});

test('a folder cannot go into itself or any of its descendants', async () => {
  stored = TREE.map(f => ({ ...f }));
  await assert.rejects(move('a', 'a'), /dentro de sí misma/);
  await assert.rejects(move('a', 'c'), /dentro de sí misma/);
  assert.equal(stored.find(f => f.id === 'a').parentId, null, 'tree unchanged');
});

test('missing folders are reported', async () => {
  stored = TREE.map(f => ({ ...f }));
  await assert.rejects(move('zz', null), /ya no existe/);
  await assert.rejects(move('d', 'zz'), /destino ya no existe/);
});

test('UI: no floating bar, selection actions inline, folders draggable', () => {
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  assert.ok(!app.includes('className="batch-floating-bar"'), 'floating bar removed');
  assert.ok(app.includes('{selectedDesignTestIds.size > 0 && canDeleteIssues && !deleteProgress && ('), 'delete action next to the selection counter');
  assert.ok(app.includes("e.dataTransfer.setData('application/x-tp-folder', String(folder.id))"));
  assert.ok(app.includes('handleMoveFolder(draggedFolderId, folder.id)') && app.includes('handleMoveFolder(draggedFolderId, null)'));
});

// ── v4.35.0: a failed read must never be written back as "no folders" (CUQ, 2026-11-19) ─────

const ctxAdmin = { accountId: 'acc-test-admin' };
const ids = (list) => list.map(f => f.id).sort();

test('creating, renaming, moving or deleting during a Jira outage changes nothing', async () => {
  stored = TREE.map(f => ({ ...f }));
  writes = 0;
  for (const failure of [503, 500, 429, 'throw']) {
    readFailure = failure;
    await assert.rejects(defs.createFolder({ payload: { projectId: '10010', name: 'Nueva', parentId: 'c' }, context: ctxAdmin }), /Jira no está respondiendo/);
    await assert.rejects(defs.updateFolder({ payload: { projectId: '10010', folderId: 'a', newName: 'X' }, context: ctxAdmin }), /Jira no está respondiendo/);
    await assert.rejects(defs.moveFolder({ payload: { projectId: '10010', folderId: 'd', newParentId: 'a' }, context: ctxAdmin }), /Jira no está respondiendo/);
    await assert.rejects(defs.deleteFolder({ payload: { projectId: '10010', folderId: 'd' }, context: ctxAdmin }), /Jira no está respondiendo/);
    await assert.rejects(defs.getFolders({ payload: { projectId: '10010' } }), /Jira no está respondiendo/);
  }
  readFailure = null;
  assert.equal(writes, 0, 'nothing was written');
  assert.deepEqual(ids(stored), ['a', 'b', 'c', 'd']);
});

test('a project without the property (404) still starts with no folders', async () => {
  missing = true;
  assert.deepEqual(await defs.getFolders({ payload: { projectId: '10010' } }), []);
  const res = await defs.createFolder({ payload: { projectId: '10010', name: 'Primera', parentId: null }, context: ctxAdmin });
  assert.equal(res.length, 1);
});

test('the browser copy is cleaned before it is restored', () => {
  const clean = sanitizeFolderBackup([
    { id: 'folder-1790117905600', name: '  Regresión  ', parentId: null },
    { id: 'folder-1790117948011', name: 'Hija', parentId: 'folder-1790117905600', extra: '<script>' },
    { id: 'folder-1790117948011', name: 'Duplicada', parentId: null },
    { id: 'no-es-carpeta', name: 'X', parentId: null },
    { id: 'folder-1790117955777', name: '', parentId: null },
    { id: 'folder-1790117964203', name: 'Padre raro', parentId: '../../etc' }
  ]);
  assert.deepEqual(clean, [
    { id: 'folder-1790117905600', name: 'Regresión', parentId: null },
    { id: 'folder-1790117948011', name: 'Hija', parentId: 'folder-1790117905600' },
    { id: 'folder-1790117964203', name: 'Padre raro', parentId: null }
  ]);
});

test('restoring adds only missing folders; stored ones win; orphans go to the root', () => {
  const storedNow = [{ id: 'folder-1795110336045', name: 'Cambio actual', parentId: 'folder-1795108374977' }];
  const backup = [
    { id: 'folder-1790117905600', name: 'Raíz vieja', parentId: null },
    { id: 'folder-1790117948011', name: 'Hija vieja', parentId: 'folder-1790117905600' },
    { id: 'folder-1795110336045', name: 'Nombre viejo', parentId: null }
  ];
  const { folders, added } = mergeFolderBackup(storedNow, backup);
  assert.equal(added, 2);
  assert.equal(folders.find(f => f.id === 'folder-1795110336045').name, 'Cambio actual', 'stored folder kept');
  assert.equal(folders.find(f => f.id === 'folder-1795110336045').parentId, null, 'its missing parent → root');
  assert.equal(folders.find(f => f.id === 'folder-1790117948011').parentId, 'folder-1790117905600');
});

test('restoreFolders merges the copy into the stored tree (admins only)', async () => {
  stored = [{ id: 'folder-1795110336045', name: 'Cambio actual', parentId: null }];
  const res = await defs.restoreFolders({ payload: { projectId: '10010', folders: [
    { id: 'folder-1790117905600', name: 'Raíz vieja', parentId: null },
    { id: 'folder-1795110336045', name: 'Nombre viejo', parentId: null }
  ] }, context: ctxAdmin });
  assert.equal(res.added, 1);
  assert.deepEqual(ids(stored), ['folder-1790117905600', 'folder-1795110336045']);
  await assert.rejects(defs.restoreFolders({ payload: { projectId: '10010', folders: [{ id: 'x', name: 'y' }] }, context: ctxAdmin }), /no tiene carpetas válidas/);
  readFailure = 503;
  await assert.rejects(defs.restoreFolders({ payload: { projectId: '10010', folders: [{ id: 'folder-1790117948011', name: 'Otra', parentId: null }] }, context: ctxAdmin }), /Jira no está respondiendo/);
  readFailure = null;
});

test('UI: restore notice and backup helpers are wired', () => {
  const app = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/App.js'), 'utf8');
  const qc = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/utils/queryClient.js'), 'utf8');
  assert.ok(app.includes("invoke('restoreFolders'"));
  assert.ok(app.includes('dropFoldersFromCache(selectedProjectId'));
  assert.ok(qc.includes("'restoreFolders',"), 'restore invalidates the cache like other folder mutations');
  assert.ok(qc.includes('export const findFoldersBackup'));
});

// ── v4.36.0: server-side history and safety brake ───────────────────────────────────────────

const F = (n, parentId = null) => ({ id: `folder-17900000000${String(n).padStart(2, '0')}`, name: `Carpeta ${n}`, parentId });

test('the brake spots folders that would vanish without being asked to', () => {
  const before = [F(1), F(2), F(3)];
  assert.deepEqual(unexpectedFolderLoss(before, [F(1), F(2), F(3), F(4)]), []);
  assert.deepEqual(unexpectedFolderLoss(before, [F(4)]), [F(1).id, F(2).id, F(3).id]);
  assert.deepEqual(unexpectedFolderLoss(before, [F(1)], [F(2).id, F(3).id]), [], 'a deleted subtree is allowed');
});

test('each change saves the previous tree; quick successive changes share one version', async () => {
  kvStore.clear();
  stored = [F(1), F(2)];
  await defs.createFolder({ payload: { projectId: '10010', name: 'Nueva', parentId: null }, context: ctxAdmin });
  await defs.updateFolder({ payload: { projectId: '10010', folderId: F(1).id, newName: 'Renombrada' }, context: ctxAdmin });
  let versions = await history.listFolderSnapshots('10010');
  assert.equal(versions.length, 1, 'the rename right after the create does not add a version');
  assert.equal(versions[0].count, 2, 'the version is the tree BEFORE the first change');
  assert.equal(versions[0].op, 'create');
  assert.equal(versions[0].by, 'acc-test-admin', 'only the accountId is stored');
  // A delete always gets its own version, even right after another change.
  await defs.deleteFolder({ payload: { projectId: '10010', folderId: F(2).id }, context: ctxAdmin });
  versions = await history.listFolderSnapshots('10010');
  assert.equal(versions.length, 2);
  assert.equal(versions[0].op, 'delete');
  assert.equal(versions[0].count, 3);
});

test('only the newest 30 versions are kept', async () => {
  kvStore.clear();
  const base = Date.now() - 1000 * 60 * 60 * 24;
  for (let i = 0; i < 35; i++) {
    await history.saveFolderSnapshot('10010', [F(1)], { op: 'move', by: 'acc', removesFolders: false, now: base + i * history.COALESCE_MS * 2 });
  }
  const versions = await history.listFolderSnapshots('10010');
  assert.equal(versions.length, history.MAX_SNAPSHOTS);
  assert.equal(versions[0].savedAt, base + 34 * history.COALESCE_MS * 2, 'newest kept');
});

test('a version is restored by merging (default) or by replacing the tree', async () => {
  kvStore.clear();
  stored = [F(1), F(2), F(3, F(2).id)];
  // The tree loses everything but a new folder (as in CUQ), through a delete of the old ones.
  await defs.deleteFolder({ payload: { projectId: '10010', folderId: F(2).id }, context: ctxAdmin });
  stored = [...stored, F(9)];
  const { versions } = await defs.getFolderHistory({ payload: { projectId: '10010' }, context: ctxAdmin });
  assert.equal(versions[0].count, 3);

  const merged = await defs.restoreFolderVersion({ payload: { projectId: '10010', snapshotId: versions[0].id }, context: ctxAdmin });
  assert.equal(merged.added, 2);
  assert.deepEqual(ids(stored), [F(1).id, F(2).id, F(3).id, F(9).id].sort(), 'folder created later is kept');

  const fresh = (await defs.getFolderHistory({ payload: { projectId: '10010' }, context: ctxAdmin })).versions;
  const target = fresh.find(v => v.count === 3);
  const replaced = await defs.restoreFolderVersion({ payload: { projectId: '10010', snapshotId: target.id, mode: 'replace' }, context: ctxAdmin });
  assert.equal(replaced.removed, 1);
  assert.deepEqual(ids(stored), [F(1).id, F(2).id, F(3).id].sort());
  // The restore itself left the previous tree in the history, so it can be undone.
  const after = (await defs.getFolderHistory({ payload: { projectId: '10010' }, context: ctxAdmin })).versions;
  assert.equal(after[0].op, 'restoreVersion');
});

test('a version of another project cannot be restored', async () => {
  await assert.rejects(defs.restoreFolderVersion({ payload: { projectId: '10010', snapshotId: 'folderSnap:OTRO:000000000000001-abcd' }, context: ctxAdmin }), /ya no existe/);
  assert.equal(history.isSnapshotOf('10010', 'folderSnap:10010:000000000000001-abcd'), true);
  assert.equal(history.isSnapshotOf('10010', 'folderSnap:100100:000000000000001-abcd'), false);
});

test('UI: Settings shows the folder history card', () => {
  const settings = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/views/SettingsView.jsx'), 'utf8');
  const qc = fs.readFileSync(path.join(ROOT_DIR, 'static/hello-world/src/utils/queryClient.js'), 'utf8');
  assert.ok(settings.includes('<FolderHistoryCard projectId={selectedProjectId}'));
  assert.ok(qc.includes("'restoreFolderVersion',"));
});
