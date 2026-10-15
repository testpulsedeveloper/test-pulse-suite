import { QueryClient } from '@tanstack/react-query';
import { invoke as forgeInvoke } from '@forge/bridge';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 180_000,
      gcTime: 600_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ── IndexedDB + L1 Memory Cache (No 5 MB sessionStorage ceiling, non-blocking, 0 calls within TTL) ──
const IDB_NAME = 'testpulse_cache_db_v4';
const IDB_STORE = 'queries';
const _l1Cache = new Map(); // key -> { ts, data }
let _idbPromise = null;
let _idbHydratedPromise = null;

const openCacheDb = () => {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.indexedDB) {
        resolve(null);
        return;
      }
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return _idbPromise;
};

// Preload all IndexedDB entries into L1 memory on iframe startup (~5ms)
const ensureIdbHydrated = () => {
  if (_idbHydratedPromise) return _idbHydratedPromise;
  _idbHydratedPromise = (async () => {
    try {
      // Clean up legacy sessionStorage entries that could waste quota
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const toDelete = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && (k.startsWith('tp_sc_v1:') || (k.startsWith('tp_') && k.endsWith('_tc')))) {
            toDelete.push(k);
          }
        }
        toDelete.forEach((k) => window.sessionStorage.removeItem(k));
      }
    } catch (_) {}

    const db = await openCacheDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = req.result || [];
          const now = Date.now();
          rows.forEach((row) => {
            if (row && row.key && typeof row.ts === 'number' && now - row.ts < 1_800_000) {
              _l1Cache.set(row.key, { ts: row.ts, data: row.data });
            }
          });
          resolve();
        };
        req.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  })();
  return _idbHydratedPromise;
};

// Start hydrating immediately on module load
ensureIdbHydrated();

const writePersistentCache = (key, data) => {
  if (data && (data._isError || data.error)) return;
  const entry = { ts: Date.now(), data };
  _l1Cache.set(key, entry);
  openCacheDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ key, ts: entry.ts, data: entry.data });
    } catch (_) {}
  });
};

export const clearPersistentCache = () => {
  _l1Cache.clear();
  openCacheDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
    } catch (_) {}
  });
};

// ── Perf instrumentation (Fase 0) + @tanstack/react-query + IndexedDB Cache Bridge ──
const TP_PERF = { startedAt: Date.now(), byName: {} };
const _tpStat = (name) =>
  (TP_PERF.byName[name] = TP_PERF.byName[name] || {
    calls: 0,
    deduped: 0,
    cached: 0,
    diskHits: 0,
    errors: 0,
    r429: 0,
    totalMs: 0,
  });

if (typeof window !== 'undefined') {
  window.tpStats = (reset = false) => {
    if (reset) {
      TP_PERF.byName = {};
      TP_PERF.startedAt = Date.now();
      queryClient.clear();
      clearPersistentCache();
      return 'reset';
    }
    const mins = ((Date.now() - TP_PERF.startedAt) / 60000).toFixed(1);
    const rows = Object.entries(TP_PERF.byName)
      .map(([name, s]) => ({
        resolver: name,
        calls: s.calls,
        deduped: s.deduped,
        ramHits: s.cached,
        diskHits: s.diskHits,
        errors: s.errors,
        r429: s.r429,
        avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls);
    const total = rows.reduce((acc, r) => acc + r.calls, 0);
    console.log(`[tpStats] ${total} llamadas reales al backend en ${mins} min`);
    console.table(rows);
    return rows;
  };
}

// All read-only resolvers with their freshness TTL in ms (0 calls to Jira while within TTL)
const TP_QUERY_RESOLVERS = {
  // Static / metadata catalogs (10 min TTL)
  getFields: 600_000,
  getProjectIssueTypes: 600_000,
  getProjectIssueTypeFields: 600_000,
  getSnapshotFieldMapping: 600_000,
  getBulkMapping: 600_000,
  getProjects: 300_000,
  isProjectAllowed: 300_000,
  checkAdminPermission: 300_000,
  getConfig: 180_000,
  getReportAutomationConfig: 180_000,
  // Operational test management data (3 min strict TTL -> 0 JQL calls when re-entering)
  getFolders: 180_000,
  getTestPlans: 180_000,
  getTestCycles: 180_000,
  getTestCases: 180_000,
  getRequirements: 180_000,
  getTraceabilityHierarchy: 180_000,
  getExecutionReport: 180_000,
  getProjectUnlinkedBugs: 180_000,
  getCycleExecutionSummary: 120_000,
  getCycleExecution: 120_000,
  getTestCaseDetails: 120_000,
  getTestCaseDetailsBatch: 120_000,
  getTestCaseHistory: 60_000,
  getIssueDescription: 120_000,
  getBugFullDetails: 60_000,
  getTestExecution: 45_000,
  searchAssignableUsers: 120_000,
};

// Explicit write/mutation resolvers that modify state and should invalidate cache
const TP_MUTATION_RESOLVERS = new Set([
  'setConfig',
  'saveReportAutomationConfig',
  'saveBulkMapping',
  'bulkCreateTestCases',
  'bulkLinkToFolder',
  'saveTestCaseDetails',
  'linkCaseToFolder',
  'createFolder',
  'updateFolder',
  'deleteFolder',
  'addTestToCycle',
  'removeTestFromCycle',
  'removeManyTestsFromCycle',
  'linkTestToFolder',
  'updateTestStatus',
  'uploadAttachment',
  'deleteAttachment',
  'linkCycleToPlan',
  'unlinkCycleFromPlan',
  'linkBugToTest',
  'bulkAssignTestRuns',
  'addBulkTestsToCycle',
  'syncCycleIndexWithRuns',
  'setAllowedProjects',
  'resyncTestRunsBatch',
]);

const _tpInFlight = new Map();

export const rawInvoke = async (name, payload) => {
  const s = _tpStat(name);
  s.calls++;
  const t0 = Date.now();
  try {
    return await forgeInvoke(name, payload);
  } catch (e) {
    s.errors++;
    if (e && (e.status === 429 || String(e.message || '').includes('429'))) s.r429++;
    console.warn('Forge invoke failed:', e);
    if (!e) {
      throw new Error('NEEDS_AUTHENTICATION_ERR');
    }
    throw e;
  } finally {
    s.totalMs += Date.now() - t0;
  }
};

export const invoke = async (name, payload) => {
  const staleTime = TP_QUERY_RESOLVERS[name];
  if (staleTime === undefined) {
    const res = await rawInvoke(name, payload);
    if (TP_MUTATION_RESOLVERS.has(name)) {
      // Only actual write mutations clear the cache
      clearPersistentCache();
      queryClient.invalidateQueries();
    }
    return res;
  }

  let serializedPayload = null;
  try {
    serializedPayload = JSON.stringify(payload ?? null);
  } catch (_) {
    return rawInvoke(name, payload);
  }

  const queryKey = ['tp', name, serializedPayload];
  const inflightKey = `${name}|${serializedPayload}`;

  if (_tpInFlight.has(inflightKey)) {
    _tpStat(name).deduped++;
    return _tpInFlight.get(inflightKey);
  }

  // 1. Check React Query RAM cache
  const state = queryClient.getQueryState(queryKey);
  if (
    state &&
    state.status === 'success' &&
    !state.isInvalidated &&
    Date.now() - state.dataUpdatedAt < staleTime
  ) {
    _tpStat(name).cached++;
    return state.data;
  }

  // 2. Ensure IndexedDB is hydrated into _l1Cache (~5ms on very first call after iframe open)
  await ensureIdbHydrated();
  const diskEntry = _l1Cache.get(inflightKey);
  if (diskEntry && Date.now() - diskEntry.ts < staleTime) {
    // Fresh in IndexedDB -> 0 calls to Jira, instant return!
    _tpStat(name).diskHits++;
    queryClient.setQueryData(queryKey, diskEntry.data, { updatedAt: diskEntry.ts });
    return diskEntry.data;
  }

  // 3. Network fetch via React Query (only when cache is missing or expired > TTL)
  const promise = queryClient
    .fetchQuery({
      queryKey,
      queryFn: async () => {
        const result = await rawInvoke(name, payload);
        const isErr =
          !result ||
          result._isError ||
          result.error ||
          (Array.isArray(result) && result.length > 0 && result[0]?.id === '999999');
        if (isErr) {
          setTimeout(() => queryClient.removeQueries({ queryKey, exact: true }), 0);
        } else {
          writePersistentCache(inflightKey, result);
        }
        return result;
      },
      staleTime,
    })
    .finally(() => {
      _tpInFlight.delete(inflightKey);
    });

  _tpInFlight.set(inflightKey, promise);
  return promise;
};
