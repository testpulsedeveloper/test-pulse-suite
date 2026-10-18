import { kvs as storage } from '@forge/kvs';

/**
 * ============================================================================
 * ENTERPRISE REPORT SNAPSHOT CACHE (L1 In-Memory + L2 Forge KVS)
 * ============================================================================
 * Designed for Test Pulse Suite Enterprise Scalability (Stage 3A+).
 *
 * Why this exists:
 * Generating the full Execution & Traceability Report (`getExecutionReport`)
 * requires multiple JQL rounds, issue property reads, and bug graph hydration.
 * When multiple QA engineers, leads, or managers open Reports or switch tabs,
 * recomputing the entire project snapshot from scratch on every request causes
 * unnecessary Jira REST API load and 3–8s wait times.
 *
 * Architecture:
 * 1. In-Flight Deduplication (`_inFlight`):
 *    If 2+ requests for the same `(projectId, offset, limit, fetchAll)` arrive
 *    simultaneously, they share a single execution promise.
 * 2. L1 In-Memory Cache (`_l1Cache`):
 *    Ultra-fast (<5ms) per-isolate cache with a 3-minute TTL and bounded size.
 * 3. L2 Shared Forge KVS Snapshot (`@forge/kvs`):
 *    Cross-user, cross-isolate snapshot divided into safe 140 KB chunks (well
 *    below Forge KVS's 200 KB per-key limit) and validated against a per-project
 *    mutation version timestamp (`tp_rep_ver_<projectId>` and `tp_rep_ver_all`).
 * 4. Automatic Mutation Invalidation (`invalidateProjectReportCache`):
 *    Any test execution change, cycle membership change, or bug update bumps
 *    the version timestamp so the next report open always reflects fresh data.
 */

const REPORT_TTL_MS = 3 * 60 * 1000; // 3 minutes TTL for warm snapshots
const MAX_L1_ENTRIES = 16;
const KVS_CHUNK_CHARS = 140000; // ~140 KB per KVS key (safe margin below 240 KB limit)
const MAX_KVS_CHUNKS = 10; // Up to ~1.4 MB serialized snapshot in L2 KVS

const _l1Cache = new Map();
const _inFlight = new Map();

/**
 * Sanitizes a cache key segment so it conforms to Forge KVS key rules
 * (alphanumeric, hyphen, underscore, dot, colon; max 100 chars).
 */
function sanitizeKeyPart(raw) {
  return String(raw || 'all').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48);
}

/**
 * Reads the latest invalidation timestamp for a project (and global fallback)
 * from Forge KVS so that any mutation across any Lambda instance invalidates
 * older snapshots immediately.
 */
async function getInvalidationTimestamp(projectId) {
  try {
    const projKey = `tp_rep_ver_${sanitizeKeyPart(projectId || 'ALL')}`;
    const [projVer, globalVer] = await Promise.all([
      storage.get(projKey).catch(() => 0),
      storage.get('tp_rep_ver_ALL').catch(() => 0)
    ]);
    return Math.max(Number(projVer) || 0, Number(globalVer) || 0);
  } catch (_err) {
    return 0;
  }
}

/**
 * Attempts to read a fresh snapshot from L1 memory or L2 Forge KVS.
 */
async function readSnapshot(cacheKey, projectId) {
  const now = Date.now();
  const minValidCreatedAt = await getInvalidationTimestamp(projectId);

  // 1. Check L1 In-Memory Cache first
  const l1Entry = _l1Cache.get(cacheKey);
  if (l1Entry) {
    if (now - l1Entry.createdAt < REPORT_TTL_MS && l1Entry.createdAt > minValidCreatedAt) {
      // Refresh LRU order
      _l1Cache.delete(cacheKey);
      _l1Cache.set(cacheKey, l1Entry);
      return l1Entry.data;
    }
    _l1Cache.delete(cacheKey);
  }

  // 2. Check L2 Shared Forge KVS Snapshot
  try {
    const baseKey = `tp_rep_s_${sanitizeKeyPart(cacheKey)}`;
    const meta = await storage.get(`${baseKey}_meta`);
    if (!meta || typeof meta !== 'object') return null;

    const createdAt = Number(meta.createdAt) || 0;
    const chunkCount = Number(meta.chunkCount) || 0;
    if (
      !createdAt ||
      now - createdAt >= REPORT_TTL_MS ||
      createdAt <= minValidCreatedAt ||
      chunkCount <= 0 ||
      chunkCount > MAX_KVS_CHUNKS
    ) {
      return null;
    }

    const chunkPromises = [];
    for (let i = 0; i < chunkCount; i++) {
      chunkPromises.push(storage.get(`${baseKey}_c${i}`));
    }
    const chunks = await Promise.all(chunkPromises);
    if (chunks.some((c) => typeof c !== 'string')) return null;

    const parsed = JSON.parse(chunks.join(''));
    // Hydrate L1 cache for subsequent hits in the same isolate
    writeL1Cache(cacheKey, projectId, parsed, createdAt);
    return parsed;
  } catch (err) {
    console.warn(`[reportSnapshotCache] L2 read skipped for ${cacheKey}:`, err?.message || err);
    return null;
  }
}

/**
 * Stores a snapshot in the bounded L1 in-memory LRU map.
 */
function writeL1Cache(cacheKey, projectId, data, createdAt = Date.now()) {
  if (_l1Cache.has(cacheKey)) {
    _l1Cache.delete(cacheKey);
  } else if (_l1Cache.size >= MAX_L1_ENTRIES) {
    const oldestKey = _l1Cache.keys().next().value;
    if (oldestKey !== undefined) _l1Cache.delete(oldestKey);
  }
  _l1Cache.set(cacheKey, {
    projectId: projectId || 'ALL',
    createdAt,
    data
  });
}

/**
 * Persists a snapshot in L1 memory immediately and writes chunks to L2 Forge KVS
 * in the background (best-effort, non-blocking on KVS limits).
 */
async function writeSnapshot(cacheKey, projectId, data) {
  const createdAt = Date.now();
  writeL1Cache(cacheKey, projectId, data, createdAt);

  try {
    const serialized = JSON.stringify(data);
    if (!serialized) return;

    const chunkCount = Math.ceil(serialized.length / KVS_CHUNK_CHARS);
    // If the payload exceeds MAX_KVS_CHUNKS, keep it in L1 memory only
    if (chunkCount > MAX_KVS_CHUNKS) return;

    const baseKey = `tp_rep_s_${sanitizeKeyPart(cacheKey)}`;
    const chunkWrites = [];
    for (let i = 0; i < chunkCount; i++) {
      const slice = serialized.slice(i * KVS_CHUNK_CHARS, (i + 1) * KVS_CHUNK_CHARS);
      chunkWrites.push(storage.set(`${baseKey}_c${i}`, slice));
    }
    await Promise.all(chunkWrites);
    await storage.set(`${baseKey}_meta`, {
      projectId: projectId || 'ALL',
      createdAt,
      chunkCount
    });
  } catch (err) {
    console.warn(`[reportSnapshotCache] L2 write skipped for ${cacheKey}:`, err?.message || err);
  }
}

/**
 * Wraps `getExecutionReport` computation with:
 * - In-flight deduplication
 * - L1 in-memory + L2 Forge KVS snapshot lookup
 * - Automatic write-through caching when `result && !result.error`
 */
export async function getCachedExecutionReport(cacheKey, projectId, computeFn) {
  // 1. Check warm snapshot (L1 / L2)
  const cached = await readSnapshot(cacheKey, projectId);
  if (cached) {
    return cached;
  }

  // 2. Deduplicate concurrent in-flight computations for the exact same key
  if (_inFlight.has(cacheKey)) {
    return _inFlight.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const freshResult = await computeFn();
      if (freshResult && !freshResult.error) {
        await writeSnapshot(cacheKey, projectId, freshResult);
      }
      return freshResult;
    } finally {
      _inFlight.delete(cacheKey);
    }
  })();

  _inFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Invalidates cached Execution Reports for a specific project (or all projects
 * when `projectId` is omitted/null). Safe to call in any mutation resolver;
 * never throws.
 */
export async function invalidateProjectReportCache(projectId = null) {
  const now = Date.now();
  try {
    if (!projectId) {
      _l1Cache.clear();
      await storage.set('tp_rep_ver_ALL', now);
      return;
    }

    const normalizedProj = String(projectId);
    for (const [key, entry] of _l1Cache.entries()) {
      if (!entry.projectId || entry.projectId === 'ALL' || String(entry.projectId) === normalizedProj) {
        _l1Cache.delete(key);
      }
    }

    const projKey = `tp_rep_ver_${sanitizeKeyPart(normalizedProj)}`;
    await storage.set(projKey, now);
  } catch (err) {
    console.warn('[reportSnapshotCache] Invalidation warning:', err?.message || err);
  }
}
