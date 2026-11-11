/**
 * @file asyncHelpers.test.js
 * @description v4.22.1: the helpers that keep the Lifecycle resolvers fast.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLimit, createShortCache } from '../src/utils/asyncHelpers.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('mapLimit keeps the order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (value, index) => {
    running++;
    peak = Math.max(peak, running);
    await wait(value * 3);
    running--;
    return `${index}:${value}`;
  });
  assert.deepEqual(results, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0']);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
  assert.deepEqual(await mapLimit(null, 4, async () => 1), []);
  await assert.rejects(mapLimit([1], 1, async () => { throw new Error('boom'); }), /boom/);
});

test('createShortCache shares one load, expires, and forgets failures', async () => {
  let clock = 1000;
  const cachedFor = createShortCache({ ttlMs: 60000, now: () => clock });
  let loads = 0;
  const loader = async () => { loads++; return [loads]; };

  // Two requests arriving together share a single load.
  const [a, b] = await Promise.all([cachedFor('cycles:user1:10001', loader), cachedFor('cycles:user1:10001', loader)]);
  assert.equal(loads, 1);
  assert.equal(a, b);
  // Another user never receives the first user's list.
  await cachedFor('cycles:user2:10001', loader);
  assert.equal(loads, 2);
  // Within the minute it is reused; after it, loaded again.
  clock += 59000;
  await cachedFor('cycles:user1:10001', loader);
  assert.equal(loads, 2);
  clock += 2000;
  await cachedFor('cycles:user1:10001', loader);
  assert.equal(loads, 3);

  // A failure is not remembered: the next call tries again.
  let attempts = 0;
  const flaky = async () => { attempts++; if (attempts === 1) throw new Error('jira down'); return 'ok'; };
  await assert.rejects(cachedFor('k', flaky), /jira down/);
  await wait(1);
  assert.equal(await cachedFor('k', flaky), 'ok');
});

test('Lifecycle uses the helpers and loads epics and plans apart', () => {
  const resolvers = read('src/resolvers/lifecycleResolvers.js');
  assert.match(resolvers, /mapLimit\(chunks, 4,/);
  assert.match(resolvers, /mapLimit\(planKeys, 5,/);
  // Lists that depend on what the user can see are remembered per user.
  assert.match(resolvers, /cachedFor\(`cycles:\$\{accountId\}:\$\{projectId\}`/);
  assert.match(resolvers, /cachedFor\(`candidates:\$\{context\.accountId\}:\$\{projectId\}`/);

  const view = read('static/hello-world/src/views/LifecycleView.jsx');
  assert.match(view, /epicKeys, planKeys: \[\] \}\)/);
  assert.match(view, /epicKeys: \[\], planKeys \}\)/);
  // Figures are reloaded right after epics or plans change (no stuck "Consultando Jira…").
  assert.match(view, /loadProgress\(saved\); \/\/ read the figures again/);
  assert.doesNotMatch(view, /resetProgress/);
});
