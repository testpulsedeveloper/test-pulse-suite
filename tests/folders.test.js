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
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const handle = async (p, init = {}) => {
  if (p.includes('/mypermissions')) return json({ permissions: { BROWSE_PROJECTS: { havePermission: true } } });
  if (p.includes('/properties/testops-folders')) {
    if (init.method === 'PUT') { stored = JSON.parse(init.body); return json({}, 200); }
    return json({ value: stored });
  }
  return json({}, 404);
};
const route = (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '');
mock.module('@forge/api', {
  defaultExport: { asUser: () => ({ requestJira: handle }), asApp: () => ({ requestJira: handle }) },
  namedExports: { route }
});

const { registerFolderResolvers } = await import('../src/resolvers/folderResolvers.js');
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
