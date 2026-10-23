import Resolver from '@forge/resolver';
import api, { route, webTrigger } from '@forge/api';
import { kvs as storage } from '@forge/kvs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getBusinessMilliseconds, analyzeBugChangelog } from './utils/slaHelpers.js';
import { jqlQuote } from './utils/jqlHelpers.js';
import {
  AuthorizationError,
  normalizeProjectRef,
  canAccessProject,
  canAdministerProject,
  isProjectEnabled,
  isSuperuser
} from './utils/authz.js';
import {
  getIterationEvidenceKeys,
  dedupeEvidences,
  filterNonIterationEvidences,
  ensureValidAdf,
  normalizeJiraStatus
} from './utils/statusAndAdfHelpers.js';
import {
  DEFAULT_CUSTOM_FIELDS,
  resolveCustomFields,
  getDefaultJqlSafeFields,
  getTestCaseJqlFields,
  getRunCandidateJqlFields,
  getRequirementJqlFields,
  getBugJqlFields,
  extractExecutionTypeFromFields,
  extractBugSeverityFromFields,
  extractBugEstimatedDateFromFields,
  computePercentiles
} from './utils/customFieldConfig.js';
import { registerFolderResolvers } from './resolvers/folderResolvers.js';
import { registerConfigResolvers } from './resolvers/configResolvers.js';
import { registerBugResolvers } from './resolvers/bugResolvers.js';
import {
  registerReportAutomationResolvers,
  createScheduledReportHandler
} from './resolvers/reportAutomationResolvers.js';
import {
  registerMobileCompanionResolvers,
  mobileUploadHandler as modularMobileUploadHandler
} from './resolvers/mobileCompanionResolvers.js';
import {
  getCachedExecutionReport,
  invalidateProjectReportCache
} from './utils/reportSnapshotCache.js';
import { summarizeJiraError } from './utils/jiraErrors.js';

// ── Enterprise Scalability Caches (Stage 3A+) ──
// In-memory 10-minute TTL caches for `/rest/api/3/myself` and `/rest/api/3/mypermissions`
// keyed by Forge accountId so every test execution click avoids 2 sequential HTTP roundtrips.
const USER_CACHE_TTL_MS = 10 * 60 * 1000;
const _userProfileCache = new Map();

async function getCachedMyself(context) {
  // Never fall back to a shared key: without an accountId the profile is fetched live and
  // only cached under the accountId Jira returns, so one user can't be recorded as another.
  const key = context?.accountId ? String(context.accountId) : null;
  const now = Date.now();
  const cached = key ? _userProfileCache.get(key) : null;
  if (cached && now - cached.at < USER_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (response.ok) {
      const data = await response.json();
      if (_userProfileCache.size >= 100) {
        const oldest = _userProfileCache.keys().next().value;
        if (oldest !== undefined) _userProfileCache.delete(oldest);
      }
      if (key) _userProfileCache.set(key, { at: now, data });
      if (data?.accountId && data.accountId !== key) {
        _userProfileCache.set(String(data.accountId), { at: now, data });
      }
      return data;
    }
  } catch (e) {
    console.error('Error fetching myself data', e);
  }
  return null;
}

async function getCachedIsProjectAdmin(projectId, context) {
  // Project admin of THIS project or Test Pulse superuser (Jira admin / superuser group).
  // Cached per Jira account inside authz.js, never shared between users.
  if (!projectId) return false;
  return canAdministerProject(projectId, context);
}

// ── Perf instrumentation (Fase 0 + Fase 3 p50/p95/maxMs) ──
// Counts real Jira REST calls (and 429s) made during each resolver invocation. Output in `forge logs`:
//   [perf] resolver=getExecutionReport jiraCalls=14 r429=0 ms=3120 p50=2850 p95=3120 maxMs=3120
// AsyncLocalStorage keeps counts correct even if invocations overlap within one instance.
// Fails open: if patching the api object isn't possible, the app keeps working uninstrumented.
const __perfALS = new AsyncLocalStorage();
const __perfSamplesByResolver = new Map();
const PERF_SAMPLE_LIMIT = 200;
try {
  for (const m of ['asUser', 'asApp']) {
    const orig = api[m];
    if (typeof orig !== 'function') continue;
    api[m] = (...args) => {
      const requester = orig.apply(api, args);
      try {
        if (requester && typeof requester.requestJira === 'function' && !requester.__tpPerf) {
          const origReq = requester.requestJira;
          requester.requestJira = async (...reqArgs) => {
            const store = __perfALS.getStore();
            const maxRetries = 3;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              if (store) store.calls++;
              const res = await origReq.apply(requester, reqArgs);
              if (res && (res.status === 429 || res.status === 503)) {
                if (store && res.status === 429) store.r429++;
                const elapsed = store?.startedAt ? (Date.now() - store.startedAt) : 0;
                // Only retry if we still have safe headroom inside Forge's 25s invocation window
                if (attempt < maxRetries && elapsed < 17500) {
                  let delay = (attempt + 1) * 1100 + Math.floor(Math.random() * 650);
                  try {
                    const retryAfter = res.headers?.get?.('Retry-After') || res.headers?.get?.('retry-after');
                    if (retryAfter) {
                      const sec = parseInt(retryAfter, 10);
                      if (!isNaN(sec) && sec > 0) {
                        delay = Math.min(sec * 1000 + Math.floor(Math.random() * 400), 6500);
                      }
                    }
                  } catch (_) {}
                  if (elapsed + delay < 20000) {
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                  }
                }
              }
              return res;
            }
          };
          requester.__tpPerf = true;
        }
      } catch (_) { /* non-writable requester: skip instrumentation for this call */ }
      return requester;
    };
  }
} catch (e) {
  console.warn('[perf] instrumentation disabled:', e?.message);
}

// Primary storage via @forge/kvs with transparent dual-read migration from legacy /rest/api/3/app/properties
const getAppStorage = async (key) => {
  try {
    const kvsVal = await storage.get(`app_prop_${key}`);
    if (kvsVal !== undefined && kvsVal !== null) {
      return kvsVal?.data !== undefined ? kvsVal.data : kvsVal;
    }
  } catch (_) {}
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/app/properties/${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    const resolved = data.value?.data ?? data.value ?? null;
    if (resolved !== null && resolved !== undefined) {
      await storage.set(`app_prop_${key}`, { data: resolved }).catch(() => {});
    }
    return resolved;
  } catch (_) {
    return null;
  }
};

const setAppStorage = async (key, val) => {
  let kvsOk = false;
  try {
    await storage.set(`app_prop_${key}`, { data: val });
    kvsOk = true;
  } catch (_) {}
  try {
    await api.asApp().requestJira(route`/rest/api/3/app/properties/${key}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: val })
    });
    return true;
  } catch (_) {
    return kvsOk;
  }
};

// Rate-limiting utility: processes items in batches with delay between batches
// Prevents burst requests that trigger Jira's 429 rate limiting
async function processInBatches(items, batchSize, delayMs, processor) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

async function fetchAllIssues(jql, fields, expand, properties, maxPages = 35) {
  let allIssues = [];
  let token = null;
  let isLast = false;
  let pages = 0;
  while (!isLast && pages < maxPages) {
    const page = await fetchJqlPage(jql, fields, expand, properties, token, 100);
    if (page.error) {
      console.error("fetchAllIssues error:", page.error);
      break;
    }
    allIssues = allIssues.concat(page.issues);
    token = page.nextPageToken;
    isLast = page.isLast;
    if (!token) break;
    pages++;
    await new Promise(r => setTimeout(r, 60));
  }
  return allIssues;
}

async function fetchJqlPage(jql, fields, expand, properties, nextPageToken = null, maxResults = 100, retries = 3) {
  try {
    let safeFields = fields;
    if (Array.isArray(fields) && fields.includes('*all')) {
      safeFields = getDefaultJqlSafeFields();
      fields.forEach(f => {
        if (f !== '*all' && !safeFields.includes(f)) safeFields.push(f);
      });
    } else if (fields === '*all') {
      safeFields = getDefaultJqlSafeFields();
    }
    
    const body = {
      jql,
      maxResults,
      fields: Array.isArray(safeFields) ? safeFields : [safeFields]
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    if (expand) body.expand = Array.isArray(expand) ? expand.join(',') : expand;
    if (properties) {
      const propArray = Array.isArray(properties) ? properties : [properties];
      // Jira REST API strictly enforces a maximum of 5 properties in JQL search
      body.properties = propArray.slice(0, 5);
    }

    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (response.status === 429 && retries > 0) {
      let delay = (4 - retries) * 1500 + Math.floor(Math.random() * 800);
      try {
        const retryAfter = response.headers?.get('Retry-After') || response.headers?.get('retry-after');
        if (retryAfter) {
          const sec = parseInt(retryAfter, 10);
          if (!isNaN(sec) && sec > 0) {
            delay = Math.min(sec * 1000 + Math.floor(Math.random() * 500), 10000);
          }
        }
      } catch (_) {}
      console.warn(`[fetchJqlPage] Rate-limited (429), waiting ${delay}ms before retry (${retries} left)`);
      await new Promise(r => setTimeout(r, delay));
      return await fetchJqlPage(jql, fields, expand, properties, nextPageToken, maxResults, retries - 1);
    }

    if (!response.ok) {
       return { error: `JQL Search failed: ${response.status} ${await response.text()}` };
    }

    const data = await response.json();
    return {
       issues: data.issues || data.values || [],
       nextPageToken: data.nextPageToken || null,
       isLast: data.isLast !== undefined ? data.isLast : (data.nextPageToken == null)
    };
  } catch(err) {
    return { error: err.message };
  }
}

const resolver = new Resolver();

// Resolvers that must keep working while Test Pulse is DISABLED in a project, so the UI
// can still load, show the "disabled" screen and let an admin switch it back on.
// (Project membership is still verified for them whenever a projectId is sent.)
const PROJECT_ENABLED_GATE_EXEMPT = new Set([
  'isProjectAllowed',
  'setAllowedProjects',
  'checkAdminPermission',
  'getConfig',
  'getProjectIssueTypes',
  'getProjects',
  'getAllowedProjects',
  'getFields',
  'getIssueLinkTypes',
  'getBulkMapping'
]);

/**
 * Central per-project authorization filter, applied to EVERY resolver before it runs.
 *
 * When the payload names a project (`payload.projectId`):
 *   1. The value must be a well-formed project ID/key.
 *   2. The user must be a member of that project (BROWSE_PROJECTS) or a Test Pulse superuser.
 *   3. Test Pulse must be enabled in that project, unless the resolver is in the exempt list
 *      above or the user administers the project (admins/superusers can always reach a
 *      disabled project in order to re-enable it).
 *
 * Admin-only actions (configuration, enabling the app, report automation, folder deletion…)
 * additionally call `requireProjectAdmin` / `canAdministerProject` inside the resolver.
 */
async function enforceProjectScope(name, req) {
  const rawProjectId = req?.payload?.projectId;
  if (rawProjectId === undefined || rawProjectId === null || rawProjectId === '') return;

  const projectRef = normalizeProjectRef(rawProjectId);
  if (!projectRef) {
    throw new AuthorizationError('INVALID_PROJECT', 'Proyecto inválido.');
  }
  if (!(await canAccessProject(projectRef, req.context))) {
    throw new AuthorizationError('FORBIDDEN', 'No tienes acceso a este proyecto en Jira.');
  }
  if (PROJECT_ENABLED_GATE_EXEMPT.has(name)) return;
  if (await isProjectEnabled(projectRef)) return;
  if (await canAdministerProject(projectRef, req.context)) return;
  throw new AuthorizationError('PROJECT_DISABLED', 'Test Pulse no está habilitado en este proyecto.');
}

// Wrap every resolver: enforce the per-project permission model, then run it inside a perf
// context and log one compact line with p50/p95/maxMs when it finishes.
{
  const __origDefine = resolver.define.bind(resolver);
  resolver.define = (name, fn) => __origDefine(name, async (req) => {
    const t0 = Date.now();
    const store = { calls: 0, r429: 0, startedAt: t0 };
    try {
      return await __perfALS.run(store, async () => {
        await enforceProjectScope(name, req);
        return fn(req);
      });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        console.warn(`[authz] resolver=${name} code=${err.code} account=${req?.context?.accountId || 'n/a'} project=${req?.payload?.projectId ?? 'n/a'}`);
        // Prefix with the code so the frontend can recognise the reason (`FORBIDDEN: ...`).
        throw new Error(`${err.code}: ${err.message}`);
      }
      throw err;
    } finally {
      const elapsed = Date.now() - t0;
      let samples = __perfSamplesByResolver.get(name);
      if (!samples) {
        samples = [];
        __perfSamplesByResolver.set(name, samples);
      }
      samples.push(elapsed);
      if (samples.length > PERF_SAMPLE_LIMIT) samples.shift();
      const { p50, p95, maxMs } = computePercentiles(samples);
      console.log(`[perf] resolver=${name} jiraCalls=${store.calls} r429=${store.r429} ms=${elapsed} p50=${p50} p95=${p95} maxMs=${maxMs}`);
    }
  });
}

// === Folder Management (Jira Entity Properties) ===
registerFolderResolvers(resolver);

// === Project Management, Configuration, Permissions, Bulk Mapping & Attachments ===
registerConfigResolvers(resolver);

// === Test Issue Queries ===
function filterValidIssueTypes(candidates, projectIssueTypes, primaryType) {
  const cleanCandidates = Array.from(new Set(
    (candidates || []).filter(t => typeof t === 'string' && t.trim().length > 0).map(t => t.trim())
  ));
  if (Array.isArray(projectIssueTypes) && projectIssueTypes.length > 0) {
    const projectTypeMap = new Map();
    const projectTypeById = new Map();
    for (const pt of projectIssueTypes) {
      const name = typeof pt === 'string' ? pt : pt?.name;
      const id = typeof pt === 'object' && pt?.id ? String(pt.id).trim() : null;
      if (name && typeof name === 'string') {
        projectTypeMap.set(name.trim().toLowerCase(), name.trim());
        if (id) projectTypeById.set(id, name.trim());
      }
    }
    const matched = [];
    for (const cand of cleanCandidates) {
      const exact = projectTypeById.get(cand) || projectTypeMap.get(cand.toLowerCase());
      if (exact && !matched.includes(exact)) {
        matched.push(exact);
      }
    }
    if (matched.length > 0) return matched;
  }
  return cleanCandidates;
}

async function fetchIssuesByCandidateTypes(projectId, projectJql, candidates, projectIssueTypes, primaryType, fields, expand, properties) {
  let validTypes = filterValidIssueTypes(candidates, projectIssueTypes, primaryType);
  if (validTypes.length === 0 && primaryType) validTypes = [primaryType];
  if (validTypes.length === 0) return [];

  const buildJql = (types) => `${projectJql}issuetype in (${types.map(t => jqlQuote(t)).join(', ')}) ORDER BY created DESC`;
  const firstPage = await fetchJqlPage(buildJql(validTypes), fields, expand, properties, null, 100);

  if (firstPage.error) {
    console.warn(`fetchIssuesByCandidateTypes multi-type JQL failed (${firstPage.error}), resolving valid project issue types...`);
    let resolvedTypes = [];
    if (projectId) {
      try {
        const projRes = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (projRes.ok) {
          const projData = await projRes.json();
          if (Array.isArray(projData.issueTypes) && projData.issueTypes.length > 0) {
            resolvedTypes = filterValidIssueTypes(candidates, projData.issueTypes, primaryType);
          }
        }
      } catch (_) {}
    }
    if (resolvedTypes.length === 0 || resolvedTypes.length === validTypes.length) {
      resolvedTypes = primaryType ? [primaryType] : [validTypes[0]];
    }
    return await fetchAllIssues(buildJql(resolvedTypes), fields, expand, properties);
  }

  let allIssues = [...(firstPage.issues || [])];
  let token = firstPage.nextPageToken;
  let isLast = firstPage.isLast;
  let pages = 1;
  while (!isLast && token && pages < 35) {
    await new Promise(r => setTimeout(r, 60));
    const page = await fetchJqlPage(buildJql(validTypes), fields, expand, properties, token, 100);
    if (page.error) break;
    allIssues = allIssues.concat(page.issues);
    token = page.nextPageToken;
    isLast = page.isLast;
    pages++;
  }
  return allIssues;
}

resolver.define('getTestPlans', async ({ payload }) => {
  try {
    const { projectId, config, projectIssueTypes } = payload || {};
    const planType = config?.planIssueType;
    const projectJql = projectId ? `project = ${jqlQuote(projectId)} AND ` : '';
    
    const candidatePlanTypes = [
      planType,
      'Test Plan',
      'Test Set',
      'Plan de Pruebas',
      'Plan de pruebas',
      'Conjunto de Pruebas',
      'TestPlan',
      'TestSet'
    ];

    const allIssues = await fetchIssuesByCandidateTypes(
      projectId,
      projectJql,
      candidatePlanTypes,
      projectIssueTypes,
      planType || 'Test Set',
      ['summary', 'status', 'created'],
      null,
      ['testpulse-schedule']
    );
    return allIssues.map(issue => {
      const props = issue.properties || {};
      const rawSchedule = props['testpulse-schedule'];
      const schedule = (rawSchedule && typeof rawSchedule === 'object')
        ? (rawSchedule.value && typeof rawSchedule.value === 'object' ? rawSchedule.value : rawSchedule)
        : null;
      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary || issue.key,
        status: issue.fields?.status?.name || 'To Do',
        schedule
      };
    });
  } catch (e) {
    console.error("getTestPlans exception:", e);
    return [];
  }
});

resolver.define('getTestCycles', async ({ payload }) => {
  try {
    const { projectId, config, projectIssueTypes } = payload || {};
    const cycleType = config?.testCycleType;
    const projectJql = projectId ? `project = ${jqlQuote(projectId)} AND ` : '';
    
    const candidateCycleTypes = [
      cycleType,
      'Test Cycle',
      'Ciclo de Pruebas',
      'Ciclo de Prueba',
      'Ciclo de prueba',
      'Ciclo',
      'TestCycle'
    ];

    // Pass at most 5 properties (Jira allows max 5)
    const propNames = ['testops-plan-link', 'testpulse-schedule', 'testpulse-v2', 'execution', 'execution-meta'];
    const allIssues = await fetchIssuesByCandidateTypes(
      projectId,
      projectJql,
      candidateCycleTypes,
      projectIssueTypes,
      cycleType || 'Test Cycle',
      ['summary', 'status', 'created', 'versions', 'fixVersions', 'parent'],
      null,
      propNames
    );
    return allIssues.map(issue => {
      const props = issue.properties || {};
      let totalTests = 0;
      const seenIds = new Set();

      const rawMeta = props['execution-meta'];
      const meta = (rawMeta && typeof rawMeta === 'object' && typeof rawMeta.total === 'number')
        ? rawMeta
        : (rawMeta?.value && typeof rawMeta.value === 'object' && typeof rawMeta.value.total === 'number' ? rawMeta.value : null);
      const hasMeta = Boolean(meta);
      
      const rawExec = props['execution'];
      const execVal = Array.isArray(rawExec) ? rawExec : (Array.isArray(rawExec?.value) ? rawExec.value : null);
      let fallbackStats = null;
      if (!hasMeta && Array.isArray(execVal)) {
        let passed = 0, failed = 0, blocked = 0, notRun = 0, other = 0;
        for (const item of execVal) {
          const id = typeof item === 'object' && item !== null ? String(item.id || item.testCaseId || '') : String(item);
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            totalTests++;
            const st = String(item?.status || 'Not Run').toLowerCase();
            if (st === 'passed' || st === 'pass' || st === 'aprobado') passed++;
            else if (st === 'failed' || st === 'fail' || st === 'fallido') failed++;
            else if (st === 'blocked' || st === 'bloqueado') blocked++;
            else if (st === 'in progress' || st === 'en curso' || st === 'retest') other++;
            else notRun++;
          }
        }
        fallbackStats = { total: totalTests, passed, failed, blocked, notRun, other };
      }
      if (hasMeta) totalTests = meta.total;
      
      const rawAff = issue.fields?.versions || [];
      const rawFix = issue.fields?.fixVersions || [];
      const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const versionDisplay = affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión');

      const planLink = props['testops-plan-link'];
      const rawSchedProp = props['testpulse-schedule'];
      const directSched = (rawSchedProp && typeof rawSchedProp === 'object')
        ? (rawSchedProp.value && typeof rawSchedProp.value === 'object' ? rawSchedProp.value : rawSchedProp)
        : null;
      const v2Prop = props['testpulse-v2']?.value || props['testpulse-v2'];
      let planId = (planLink && typeof planLink === 'object')
        ? (planLink.planId || planLink.value?.planId || null)
        : (typeof planLink === 'string' ? planLink : (v2Prop?.planId || null));
      const schedule = (directSched && (directSched.startDate || directSched.endDate || directSched.holidays || directSched.environment))
        ? directSched
        : ((planLink && typeof planLink === 'object' && (planLink.schedule || planLink.value?.schedule))
          ? (planLink.schedule || planLink.value?.schedule)
          : (directSched || v2Prop?.schedule || null));
      if (!planId && issue.fields?.parent) {
        const pType = (issue.fields.parent.fields?.issuetype?.name || '').toLowerCase();
        if (pType.includes('plan') || pType.includes('set')) {
          planId = issue.fields.parent.id || issue.fields.parent.key;
        }
      }
      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary || issue.key,
        status: issue.fields?.status?.name || 'To Do',
        planId,
        schedule,
        environment: schedule?.environment || '',
        version: versionDisplay,
        versions: affectsVersions,
        fixVersions: fixVersions,
        rawFields: {
          created: issue.fields?.created || null,
          status: issue.fields?.status ? { name: issue.fields.status.name } : undefined,
          versions: affectsVersions,
          fixVersions: fixVersions
        },
        testCount: totalTests,
        executionMeta: hasMeta ? meta : fallbackStats
      };
    });
  } catch (e) {
    console.error("getTestCycles exception:", e);
    return [];
  }
});

resolver.define('linkCycleToPlan', async ({ payload }) => {
  const { cycleId, planId } = payload;
  let existingSchedule = null;
  try {
    const getRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (getRes.ok) {
      const data = await getRes.json();
      existingSchedule = data?.value?.schedule || data?.schedule || null;
    }
  } catch (e) {}
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(existingSchedule ? { planId, schedule: existingSchedule } : { planId })
  });
  return true;
});

resolver.define('unlinkCycleFromPlan', async ({ payload }) => {
  const { cycleId } = payload;
  let existingSchedule = null;
  try {
    const getRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (getRes.ok) {
      const data = await getRes.json();
      existingSchedule = data?.value?.schedule || data?.schedule || null;
    }
  } catch (e) {}
  if (existingSchedule) {
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: null, schedule: existingSchedule })
    });
  } else {
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
      method: 'DELETE'
    });
  }
  return true;
});

// Save schedule metadata (startDate, endDate, excludeWeekends, holidays, naturalDays, businessDays, statusBadge) on a Test Plan issue
resolver.define('savePlanSchedule', async ({ payload }) => {
  const { planId, schedule } = payload || {};
  if (!planId || !schedule) throw new Error('Missing planId or schedule');
  const cleanSchedule = {
    startDate: schedule.startDate || '',
    endDate: schedule.endDate || '',
    excludeWeekends: schedule.excludeWeekends !== false,
    holidays: Array.isArray(schedule.holidays) ? schedule.holidays : [],
    naturalDays: Number(schedule.naturalDays) || 0,
    businessDays: Number(schedule.businessDays) || 0,
    statusBadge: schedule.statusBadge || 'ACTIVO',
    updatedAt: new Date().toISOString()
  };
  await api.asUser().requestJira(route`/rest/api/3/issue/${planId}/properties/testpulse-schedule`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(cleanSchedule)
  });
  return { success: true, schedule: cleanSchedule };
});

// Save schedule metadata (startDate, endDate, sprint, planningStatus, environment, excludeWeekends, holidays, naturalDays, businessDays) on a Test Cycle issue
resolver.define('saveCycleSchedule', async ({ payload }) => {
  const { cycleId, planId, schedule } = payload || {};
  if (!cycleId || !schedule) throw new Error('Missing cycleId or schedule');
  let currentPlanId = planId || null;
  let existingSchedule = null;
  const hasExplicitEnv = typeof schedule.environment === 'string';
  // Only perform GET if we are missing either planId or explicit environment
  if (!currentPlanId || !hasExplicitEnv) {
    try {
      const getRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (getRes.ok) {
        const data = await getRes.json();
        if (!currentPlanId) {
          currentPlanId = data?.value?.planId || data?.planId || null;
        }
        existingSchedule = data?.value?.schedule || data?.schedule || null;
      }
    } catch (e) {}
  }
  const resolvedEnvironment = hasExplicitEnv
    ? schedule.environment.trim()
    : (existingSchedule?.environment || '');
  const cleanSchedule = {
    startDate: schedule.startDate || '',
    endDate: schedule.endDate || '',
    sprint: schedule.sprint || '',
    planningStatus: schedule.planningStatus || 'EN CURSO',
    environment: resolvedEnvironment,
    excludeWeekends: schedule.excludeWeekends !== false,
    holidays: Array.isArray(schedule.holidays) ? schedule.holidays : [],
    naturalDays: Number(schedule.naturalDays) || 0,
    businessDays: Number(schedule.businessDays) || 0,
    updatedAt: new Date().toISOString()
  };
  await Promise.all([
    api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: currentPlanId, schedule: cleanSchedule })
    }),
    api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testpulse-schedule`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanSchedule)
    })
  ]);
  return { success: true, schedule: cleanSchedule, planId: currentPlanId };
});

// === Fields Management ===
resolver.define('getFields', async () => {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/field`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      console.error(`getFields failed: ${response.status} ${response.statusText}`);
      return { _isError: true, status: response.status, message: summarizeJiraError(await response.text()) };
    }
    const data = await response.json();
    return data;
  } catch (e) {
    console.error("getFields exception:", e);
    return { _isError: true, message: String(e) };
  }
});

resolver.define('getProjectIssueTypeFields', async ({ payload }) => {
  try {
    const { projectId, issueTypeName = 'Test Case' } = payload;
    if (!projectId) return { _isError: true, message: 'Missing projectId' };
    
    // 1. Obtener los issue types del proyecto usando asUser para evitar problemas de permisos de la App
    const typesRes = await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectId}/issuetypes`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!typesRes.ok) {
      console.error(`createmeta issuetypes failed: ${typesRes.status}`);
      return { _isError: true, status: typesRes.status };
    }
    const typesData = await typesRes.json();
    const issuetypes = typesData.values || [];
    
    // Buscar "Test Case" case-insensitive
    const targetType = issueTypeName.toLowerCase();
    const issuetype = issuetypes.find(t => t.name.toLowerCase() === targetType) || issuetypes[0];
    if (!issuetype) return {};

    // 2. Obtener los campos de ese issue type en especifico usando asUser
    const fieldsRes = await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectId}/issuetypes/${issuetype.id}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!fieldsRes.ok) {
      console.error(`createmeta fields failed: ${fieldsRes.status}`);
      return { _isError: true, status: fieldsRes.status };
    }
    const fieldsData = await fieldsRes.json();
    
    // Convertir el array de values a un diccionario indexado por fieldId
    const fieldsDict = {};
    if (fieldsData.values && Array.isArray(fieldsData.values)) {
      fieldsData.values.forEach(f => {
        fieldsDict[f.fieldId] = f;
      });
    }
    return fieldsDict;
  } catch (e) {
    console.error("getProjectIssueTypeFields exception:", e);
    return { _isError: true, message: String(e) };
  }
});

// === Test Case Management (Jira REST API) ===
resolver.define('getTestCases', async ({ payload, context }) => {
  const { folderId, projectId, config, nextPageToken } = payload;
  const tcType = config?.testCaseType || 'Test Case';
  
  const projectJql = projectId ? `project = ${jqlQuote(projectId)} AND ` : '';
  const candidateTcTypes = [
    tcType,
    'Test Case',
    'Caso de prueba',
    'Caso de Prueba',
    'Prueba',
    'Test',
    'TestCase'
  ];
  const validTcTypes = filterValidIssueTypes(candidateTcTypes, payload?.projectIssueTypes, tcType);

  let jql = `${projectJql}issuetype in (${validTcTypes.map(t => jqlQuote(t)).join(', ')}) ORDER BY created DESC`;
  
  let fieldsToFetch = getTestCaseJqlFields(config, payload);
  
  let pageData = await fetchJqlPage(jql, fieldsToFetch, null, ['testops-folder-link'], nextPageToken, 100);
  if (pageData.error && validTcTypes.length > 1) {
     let fallbackTypes = [tcType];
     if (projectId) {
       try {
         const projRes = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
         if (projRes.ok) {
           const projData = await projRes.json();
           if (Array.isArray(projData.issueTypes) && projData.issueTypes.length > 0) {
             fallbackTypes = filterValidIssueTypes(candidateTcTypes, projData.issueTypes, tcType);
           }
         }
       } catch (e) { /* ignore */ }
     }
     const retryJql = `${projectJql}issuetype in (${fallbackTypes.map(t => jqlQuote(t)).join(', ')}) ORDER BY created DESC`;
     pageData = await fetchJqlPage(retryJql, fieldsToFetch, null, ['testops-folder-link'], nextPageToken, 100);
     if (pageData.error && fallbackTypes.length > 1) {
       const singleJql = `${projectJql}issuetype = ${jqlQuote(tcType)} ORDER BY created DESC`;
       pageData = await fetchJqlPage(singleJql, fieldsToFetch, null, ['testops-folder-link'], nextPageToken, 100);
     }
  }
  if (pageData.error) {
     return [{ id: '999999', key: 'ERR-1', rawFields: { summary: pageData.error } }];
  }
  
  const mapped = pageData.issues.map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || '',
      created: issue.fields?.created || '',
      folderId: issue.properties?.['testops-folder-link']?.folderId || null,
      rawFields: issue.fields || {}
  }));
  
  return {
     issues: mapped,
     nextPageToken: pageData.nextPageToken,
     isLast: pageData.isLast
  };
});

resolver.define('getRequirements', async ({ payload, context }) => {
  try {
    const projectId = payload?.projectId || context?.extension?.project?.id;
    let effectiveConfig = payload?.config || {};
    if (projectId && (!effectiveConfig.requirementIssueTypes || effectiveConfig.requirementIssueTypes.length === 0)) {
      try {
        const cfgResp = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
        if (cfgResp.ok) {
          const cfgData = await cfgResp.json();
          if (cfgData?.value) {
            effectiveConfig = { ...cfgData.value, ...effectiveConfig };
          }
        }
      } catch (_) {}
    }

    let requirementTypes = (effectiveConfig?.requirementIssueTypes || []).filter(Boolean);
    const issueKeys = Array.isArray(payload?.issueKeys)
      ? Array.from(new Set(payload.issueKeys.filter(k => typeof k === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(k.trim())).map(k => k.trim().toUpperCase())))
      : [];

    const nonStoryWords = [
      'task', 'tarea', 'sub-task', 'subtarea', 'subtask',
      'test case', 'testcase', 'caso de prueba', 'casos de prueba',
      'test cycle', 'testcycle', 'ciclo de prueba', 'ciclo de pruebas', 'ciclo',
      'test plan', 'testplan', 'plan de prueba', 'plan de pruebas', 'test set', 'testset',
      'test run', 'testrun', 'ejecución', 'ejecucion',
      'bug', 'defecto', 'error', 'incidencia',
      (effectiveConfig?.testCaseType || '').toLowerCase().trim(),
      (effectiveConfig?.testCycleType || '').toLowerCase().trim(),
      (effectiveConfig?.planIssueType || '').toLowerCase().trim(),
      (effectiveConfig?.testRunType || '').toLowerCase().trim()
    ].filter(Boolean);

    const isEpicIssueType = (typeName, hierarchyLevel) => {
      if (hierarchyLevel === 1) return true;
      const lower = String(typeName || '').toLowerCase().trim();
      return lower === 'epic' || lower === 'épica' || lower === 'epica' || lower.includes('epic') || lower.includes('épica');
    };

    const configuredStoryTypesLower = requirementTypes
      .map(t => String(t).toLowerCase().trim())
      .filter(t => t && !isEpicIssueType(t) && !nonStoryWords.some(w => t === w || t.includes(w)));

    const isValidStoryIssueType = (typeName, isSubtask = false, hierarchyLevel = 0) => {
      if (!typeName || isSubtask || hierarchyLevel === 1 || hierarchyLevel === -1) return false;
      const lower = String(typeName).toLowerCase().trim();
      if (isEpicIssueType(lower, hierarchyLevel)) return false;
      if (nonStoryWords.some(w => lower === w || lower.includes(w))) return false;
      if (configuredStoryTypesLower.length > 0) {
        return configuredStoryTypesLower.some(cfg => lower === cfg || lower.includes(cfg) || cfg.includes(lower));
      }
      return ['story', 'historia', 'historia de usuario', 'user story'].some(w => lower === w || lower.includes(w));
    };

    let allIssues = [];
    const cf = resolveCustomFields(effectiveConfig);
    const fields = getRequirementJqlFields(effectiveConfig);

    if (issueKeys.length > 0) {
      for (let i = 0; i < Math.min(issueKeys.length, 500); i += 100) {
        const chunk = issueKeys.slice(i, i + 100);
        const keyList = chunk.map(k => jqlQuote(k)).join(', ');
        const jql = `issueKey IN (${keyList})`;
        const pageData = await fetchJqlPage(jql, fields, null, null, null, 100);
        if (!pageData?.error && Array.isArray(pageData?.issues)) {
          allIssues = allIssues.concat(pageData.issues);
        }
      }
    } else {
      const validReqTypes = requirementTypes.filter(t => {
        const l = String(t).toLowerCase().trim();
        return isEpicIssueType(l) || isValidStoryIssueType(l);
      });
      const queryTypes = validReqTypes.length > 0
        ? validReqTypes
        : ['Story', 'Historia', 'Historia de usuario', 'User Story', 'Epic', 'Épica'];
      const projectJql = projectId ? `project = ${jqlQuote(projectId)} AND ` : '';
      const typeList = queryTypes.map(t => jqlQuote(t)).join(', ');
      const jql = `${projectJql}issuetype IN (${typeList}) ORDER BY created DESC`;
      allIssues = await fetchAllIssues(jql, fields, null, null, 5);
    }

    // Filter strictly to Epics and Stories (never return Tasks, Test Cases, Bugs, etc.)
    allIssues = (allIssues || []).filter(iss => {
      const iType = iss?.fields?.issuetype;
      const tName = iType?.name || '';
      return isEpicIssueType(tName, iType?.hierarchyLevel) || isValidStoryIssueType(tName, iType?.subtask, iType?.hierarchyLevel);
    });

    // Resolve any Epic keys from configured epicLink / customfield_10014 or parent where summary is missing
    const knownSummaries = {};
    allIssues.forEach(iss => {
      if (iss?.key && iss?.fields?.summary) {
        knownSummaries[iss.key.toUpperCase()] = iss.fields.summary;
      }
    });

    const missingEpicKeys = new Set();
    allIssues.forEach(iss => {
      const p = iss?.fields?.parent;
      const cf10014 = iss?.fields?.[cf.epicLink] || iss?.fields?.customfield_10014;
      if (p?.key) {
        if (p.fields?.summary) {
          knownSummaries[p.key.toUpperCase()] = p.fields.summary;
        } else if (!knownSummaries[p.key.toUpperCase()]) {
          missingEpicKeys.add(p.key.toUpperCase());
        }
      } else if (typeof cf10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(cf10014.trim())) {
        const ek = cf10014.trim().toUpperCase();
        if (!knownSummaries[ek]) {
          missingEpicKeys.add(ek);
        }
      }
    });

    if (missingEpicKeys.size > 0) {
      const missingArr = Array.from(missingEpicKeys).slice(0, 100);
      const epJql = `issueKey IN (${missingArr.map(k => jqlQuote(k)).join(', ')})`;
      const epPage = await fetchJqlPage(epJql, ['summary'], null, null, null, 100);
      if (!epPage?.error && Array.isArray(epPage?.issues)) {
        epPage.issues.forEach(ep => {
          if (ep?.key) knownSummaries[ep.key.toUpperCase()] = ep.fields?.summary || '';
        });
      }
    }

    // Enrich each issue with resolved epicKey and epicSummary for direct consumption
    return allIssues.map(iss => {
      const p = iss?.fields?.parent;
      const cf10014 = iss?.fields?.[cf.epicLink] || iss?.fields?.customfield_10014;
      let epicKey = null;
      let epicSummary = null;
      if (p?.key) {
        epicKey = p.key;
        epicSummary = p.fields?.summary || knownSummaries[p.key.toUpperCase()] || null;
      } else if (typeof cf10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(cf10014.trim())) {
        epicKey = cf10014.trim().toUpperCase();
        epicSummary = knownSummaries[epicKey] || null;
      } else if (cf10014 && typeof cf10014 === 'object' && cf10014.key) {
        epicKey = cf10014.key;
        epicSummary = cf10014.summary || knownSummaries[cf10014.key.toUpperCase()] || null;
      }
      return {
        ...iss,
        epicKey,
        epicSummary
      };
    });
  } catch (e) {
    console.error("getRequirements exception:", e);
    return [];
  }
});

resolver.define('getTraceabilityHierarchy', async ({ payload, context }) => {
  try {
    const projectId = payload?.projectId || context?.extension?.project?.id;
    if (!projectId) return { epics: [], stories: [], storyMap: {}, storiesByEpic: {}, tcMap: {} };

    let effectiveConfig = payload?.config || {};
    if (!effectiveConfig.requirementIssueTypes || effectiveConfig.requirementIssueTypes.length === 0) {
      try {
        const cfgResp = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
        if (cfgResp.ok) {
          const cfgData = await cfgResp.json();
          if (cfgData?.value) {
            effectiveConfig = { ...cfgData.value, ...effectiveConfig };
          }
        }
      } catch (_) {}
    }

    const reqFields = getRequirementJqlFields(effectiveConfig);
    const cf = resolveCustomFields(effectiveConfig);

    // Step 0: Get project issue types to identify exact Epic and Story type IDs and names
    let epicTypeNames = [];
    let epicTypeIds = [];
    let availableTypes = [];
    let resolvedProjectKey = projectId;
    try {
      const pResp = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
      if (pResp.ok) {
        const pData = await pResp.json();
        if (pData && pData.key) resolvedProjectKey = pData.key;
        if (Array.isArray(pData.issueTypes)) {
          availableTypes = pData.issueTypes;
          const foundEpics = pData.issueTypes.filter(t => {
            const nl = (t.name || '').toLowerCase().trim();
            return nl === 'epic' || nl === 'épica' || nl === 'epica' || nl.includes('epic') || nl.includes('épica') || t.hierarchyLevel === 1;
          });
          if (foundEpics.length > 0) {
            epicTypeNames = foundEpics.map(t => t.name);
            epicTypeIds = foundEpics.map(t => t.id).filter(Boolean);
          }
        }
      }
    } catch (_) {}

    if (epicTypeNames.length === 0) {
      epicTypeNames = ['Epic', 'Épica'];
    }

    // Step 1: Traer las ÉPICAS del proyecto (hasta 500 épicas)
    const epicTypeSelector = epicTypeIds.length > 0
      ? epicTypeIds.join(', ')
      : epicTypeNames.map(t => jqlQuote(t)).join(', ');
    const epicsJql = `project = ${jqlQuote(resolvedProjectKey)} AND issuetype IN (${epicTypeSelector}) ORDER BY created DESC`;
    const rawEpics = await fetchAllIssues(epicsJql, ['summary', 'status', 'issuelinks'], null, null, 5);
    const epics = (rawEpics || []).map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || '',
      statusCategory: issue.fields?.status?.statusCategory?.key || '',
      issuelinks: issue.fields?.issuelinks || []
    }));

    const epicMap = {};
    epics.forEach(e => {
      if (e.key) epicMap[e.key.toUpperCase()] = e;
    });

    // Define all issue types that belong to tasks, subtasks, test management, or defects and must NEVER be treated as Stories
    const blacklistWords = [
      'task', 'tarea', 'sub-task', 'subtarea', 'subtask',
      'test case', 'testcase', 'caso de prueba', 'casos de prueba',
      'test cycle', 'testcycle', 'ciclo de prueba', 'ciclo de pruebas', 'ciclo',
      'test plan', 'testplan', 'plan de prueba', 'plan de pruebas', 'test set', 'testset',
      'test run', 'testrun', 'ejecución', 'ejecucion',
      'bug', 'defecto', 'error', 'incidencia',
      ...epicTypeNames.map(n => (n || '').toLowerCase().trim()),
      (effectiveConfig?.testCaseType || '').toLowerCase().trim(),
      (effectiveConfig?.testCycleType || '').toLowerCase().trim(),
      (effectiveConfig?.planIssueType || '').toLowerCase().trim(),
      (effectiveConfig?.testRunType || '').toLowerCase().trim()
    ].filter(Boolean);

    const isBlacklistedType = (typeName) => {
      if (!typeName) return false;
      const lower = String(typeName).toLowerCase().trim();
      return blacklistWords.some(w => lower === w || lower.includes(w));
    };

    // Step 2: Traer estrictamente las HISTORIAS del proyecto según la configuración (excluyendo Tareas y Épicas)
    let configuredReqTypes = (effectiveConfig?.requirementIssueTypes || [])
      .map(t => String(t).trim())
      .filter(t => t && !isBlacklistedType(t));

    const configuredStoryLower = configuredReqTypes.map(t => t.toLowerCase());
    const defaultStoryWords = ['story', 'historia', 'historia de usuario', 'user story'];

    const isAllowedStoryType = (typeName) => {
      if (!typeName) return false;
      const lower = String(typeName).toLowerCase().trim();
      if (isBlacklistedType(lower)) return false;
      if (configuredStoryLower.length > 0) {
        return configuredStoryLower.some(cfg => lower === cfg || lower.includes(cfg) || cfg.includes(lower));
      }
      return defaultStoryWords.some(w => lower === w || lower.includes(w));
    };

    let validProjectTypes = [];
    if (availableTypes.length > 0) {
      validProjectTypes = availableTypes.filter(
        t => !t.subtask && t.hierarchyLevel !== 1 && isAllowedStoryType(t.name)
      );
    }

    let rawStories = [];
    if (validProjectTypes.length > 0) {
      const validTypeIds = validProjectTypes.map(t => t.id).filter(Boolean);
      const storiesJql = `project = ${jqlQuote(resolvedProjectKey)} AND issuetype IN (${validTypeIds.join(', ')}) ORDER BY created DESC`;
      rawStories = await fetchAllIssues(storiesJql, reqFields, null, null, 10);
    } else {
      let reqTypes = configuredReqTypes.length > 0
        ? configuredReqTypes
        : ['Story', 'Historia', 'Historia de usuario', 'User Story'];
      const typeList = reqTypes.map(t => jqlQuote(t)).join(', ');
      const storiesJql = `project = ${jqlQuote(resolvedProjectKey)} AND issuetype IN (${typeList}) ORDER BY created DESC`;
      rawStories = await fetchAllIssues(storiesJql, reqFields, null, null, 10);
    }

    // Fallback: si la consulta por issuetype devolvió vacío, consultar issues del proyecto y filtrar en memoria por isAllowedStoryType
    if (!rawStories || rawStories.length === 0) {
      const fallbackJql = `project = ${jqlQuote(resolvedProjectKey)} ORDER BY created DESC`;
      rawStories = await fetchAllIssues(fallbackJql, reqFields, null, null, 10);
    }

    const stories = (rawStories || [])
      .filter(issue => !issue.fields?.issuetype?.subtask && isAllowedStoryType(issue.fields?.issuetype?.name))
      .map(issue => ({
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || '',
        statusCategory: issue.fields?.status?.statusCategory?.key || '',
        issuetype: issue.fields?.issuetype?.name || '',
        parent: issue.fields?.parent || null,
        customfield_10014: issue.fields?.[cf.epicLink] || issue.fields?.customfield_10014 || null,
        issuelinks: issue.fields?.issuelinks || []
      }));

    // If epics exist, also find any Stories directly having parent in epics (in chunks of 50 epics)
    if (epics.length > 0) {
      const seenKeys = new Set(stories.map(s => s.key));
      for (let i = 0; i < Math.min(epics.length, 200); i += 50) {
        const epicChunk = epics.slice(i, i + 50).map(e => jqlQuote(e.key)).join(', ');
        try {
          const childrenJql = `parent IN (${epicChunk}) ORDER BY created DESC`;
          const childrenIssues = await fetchAllIssues(childrenJql, reqFields, null, null, 3);
          if (Array.isArray(childrenIssues)) {
            childrenIssues.forEach(issue => {
              const issueType = issue.fields?.issuetype?.name || '';
              if (issue.fields?.issuetype?.subtask || !isAllowedStoryType(issueType)) return;
              if (!seenKeys.has(issue.key)) {
                seenKeys.add(issue.key);
                stories.push({
                  id: issue.id,
                  key: issue.key,
                  summary: issue.fields?.summary || '',
                  status: issue.fields?.status?.name || '',
                  statusCategory: issue.fields?.status?.statusCategory?.key || '',
                  issuetype: issueType,
                  parent: issue.fields?.parent || null,
                  customfield_10014: issue.fields?.[cf.epicLink] || issue.fields?.customfield_10014 || null,
                  issuelinks: issue.fields?.issuelinks || []
                });
              }
            });
          }
        } catch (_) {}
      }
    }

    // Step 2b: Check epic.issuelinks for any Stories linked to Epics via standard Jira issue links
    const epicLinkedStoryMap = {}; // storyKeyUpper -> { epicKey, epicSummary }
    const unseenStoryKeys = new Set();
    const seenStoryKeysUpper = new Set(stories.map(s => (s.key || '').toUpperCase()));

    epics.forEach(epic => {
      if (Array.isArray(epic.issuelinks)) {
        epic.issuelinks.forEach(link => {
          const cand = link.inwardIssue || link.outwardIssue;
          if (!cand || !cand.key) return;
          const candKeyUpper = cand.key.toUpperCase();
          const candType = cand.fields?.issuetype?.name || '';
          if (candType && !isAllowedStoryType(candType)) return;
          if (epicMap[candKeyUpper]) return; // Ignore epic-to-epic links
          if (!epicLinkedStoryMap[candKeyUpper]) {
            epicLinkedStoryMap[candKeyUpper] = { epicKey: epic.key, epicSummary: epic.summary };
          }
          if (!seenStoryKeysUpper.has(candKeyUpper)) {
            unseenStoryKeys.add(candKeyUpper);
          }
        });
      }
    });

    if (unseenStoryKeys.size > 0) {
      const unseenArr = Array.from(unseenStoryKeys).slice(0, 100);
      try {
        const stPage = await fetchJqlPage(`issueKey IN (${unseenArr.map(k => jqlQuote(k)).join(', ')})`, reqFields, null, null, null, 100);
        if (!stPage?.error && Array.isArray(stPage?.issues)) {
          stPage.issues.forEach(issue => {
            const issueType = issue.fields?.issuetype?.name || '';
            const kUpper = (issue.key || '').toUpperCase();
            if (issue.fields?.issuetype?.subtask || !isAllowedStoryType(issueType)) {
              delete epicLinkedStoryMap[kUpper];
              return;
            }
            if (!seenStoryKeysUpper.has(kUpper)) {
              seenStoryKeysUpper.add(kUpper);
              stories.push({
                id: issue.id,
                key: issue.key,
                summary: issue.fields?.summary || '',
                status: issue.fields?.status?.name || '',
                statusCategory: issue.fields?.status?.statusCategory?.key || '',
                issuetype: issueType,
                parent: issue.fields?.parent || null,
                customfield_10014: issue.fields?.[cf.epicLink] || issue.fields?.customfield_10014 || null,
                issuelinks: issue.fields?.issuelinks || []
              });
            }
          });
        }
      } catch (_) {}
    }

    // Step 2c: Resolve any missing Epic summaries (e.g. cross-project Epics or customfield_10014 links)
    const isEpicIssueType = (typeName, hierarchyLevel) => {
      if (hierarchyLevel === 1) return true;
      const lower = String(typeName || '').toLowerCase().trim();
      return lower === 'epic' || lower === 'épica' || lower === 'epica' || lower.includes('epic') || lower.includes('épica');
    };

    const missingEpicKeys = new Set();
    stories.forEach(story => {
      if (story.parent?.key) {
        const pk = story.parent.key.toUpperCase();
        const pType = story.parent.fields?.issuetype?.name || '';
        const pLevel = story.parent.fields?.issuetype?.hierarchyLevel;
        if (pType && !isEpicIssueType(pType, pLevel)) {
          story.parent = null;
          return;
        }
        if (!epicMap[pk]) {
          if (story.parent.fields?.summary && isEpicIssueType(pType, pLevel)) {
            const entry = {
              id: story.parent.id || pk,
              key: story.parent.key,
              summary: story.parent.fields.summary,
              status: story.parent.fields?.status?.name || '',
              statusCategory: story.parent.fields?.status?.statusCategory?.key || '',
              issuelinks: []
            };
            epicMap[pk] = entry;
            epics.push(entry);
          } else {
            missingEpicKeys.add(pk);
          }
        }
      } else if (typeof story.customfield_10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(story.customfield_10014.trim())) {
        const ek = story.customfield_10014.trim().toUpperCase();
        if (!epicMap[ek]) missingEpicKeys.add(ek);
      }
    });

    if (missingEpicKeys.size > 0) {
      const missingArr = Array.from(missingEpicKeys).slice(0, 100);
      try {
        const epPage = await fetchJqlPage(`issueKey IN (${missingArr.map(k => jqlQuote(k)).join(', ')})`, ['summary', 'status', 'issuetype'], null, null, null, 100);
        if (!epPage?.error && Array.isArray(epPage?.issues)) {
          epPage.issues.forEach(ep => {
            if (ep?.key && isEpicIssueType(ep.fields?.issuetype?.name, ep.fields?.issuetype?.hierarchyLevel)) {
              const entry = {
                id: ep.id,
                key: ep.key,
                summary: ep.fields?.summary || '',
                status: ep.fields?.status?.name || '',
                statusCategory: ep.fields?.status?.statusCategory?.key || '',
                issuelinks: []
              };
              epicMap[ep.key.toUpperCase()] = entry;
              epics.push(entry);
            }
          });
        }
      } catch (_) {}
    }

    // Step 3: En las Historias, mapear los CASOS DE PRUEBA ligados
    const tcMap = {}; // testCaseKeyOrId -> { epicKey, epicSummary, storyKey, storySummary, storyStatus, storyStatusCategory }
    const storyMap = {}; // storyKey -> { key, summary, status, statusCategory, epicKey, epicSummary, linkedTestCases }
    const storiesByEpic = {};

    stories.forEach(story => {
      if (isBlacklistedType(story.issuetype)) return;

      let epicKey = null;
      let epicSummary = null;

      if (story.parent?.key) {
        epicKey = story.parent.key;
        epicSummary = story.parent.fields?.summary || epicMap[epicKey.toUpperCase()]?.summary || null;
      } else if (typeof story.customfield_10014 === 'string' && /^[A-Z][A-Z0-9]+-\d+$/i.test(story.customfield_10014.trim())) {
        epicKey = story.customfield_10014.trim().toUpperCase();
        epicSummary = epicMap[epicKey]?.summary || null;
      } else if (story.customfield_10014 && typeof story.customfield_10014 === 'object' && story.customfield_10014.key) {
        epicKey = story.customfield_10014.key;
        epicSummary = story.customfield_10014.summary || epicMap[epicKey.toUpperCase()]?.summary || null;
      }

      // Check if an Epic linked to this Story via epic.issuelinks
      if (!epicKey && story.key && epicLinkedStoryMap[story.key.toUpperCase()]) {
        epicKey = epicLinkedStoryMap[story.key.toUpperCase()].epicKey;
        epicSummary = epicLinkedStoryMap[story.key.toUpperCase()].epicSummary;
      }

      // Also check if story has an issuelink directly to an Epic
      if (!epicKey && Array.isArray(story.issuelinks)) {
        for (const link of story.issuelinks) {
          const cand = link.inwardIssue || link.outwardIssue;
          if (cand?.key) {
            const cType = (cand.fields?.issuetype?.name || '').toLowerCase().trim();
            if (cType === 'epic' || cType === 'épica' || cType.includes('epic') || cType.includes('épica') || epicMap[cand.key.toUpperCase()]) {
              epicKey = cand.key;
              epicSummary = cand.fields?.summary || epicMap[cand.key.toUpperCase()]?.summary || null;
              if (!epicMap[cand.key.toUpperCase()]) {
                const entry = {
                  id: cand.id || cand.key,
                  key: cand.key,
                  summary: epicSummary || '',
                  status: cand.fields?.status?.name || '',
                  statusCategory: cand.fields?.status?.statusCategory?.key || '',
                  issuelinks: []
                };
                epicMap[cand.key.toUpperCase()] = entry;
                epics.push(entry);
              }
              break;
            }
          }
        }
      }

      const linkedTestCases = [];
      const seenTc = new Set();

      // Read linked test cases in this story's issuelinks
      if (Array.isArray(story.issuelinks)) {
        story.issuelinks.forEach(link => {
          const cand = link.inwardIssue || link.outwardIssue;
          if (cand && cand.key) {
            const candType = (cand.fields?.issuetype?.name || '').toLowerCase().trim();
            // Never treat test runs, bugs, cycles, plans, or epics as test cases
            if (candType && (
              candType.includes('test run') || candType.includes('testrun') || candType.includes('ejecuc') ||
              candType.includes('test cycle') || candType.includes('testcycle') || candType.includes('ciclo') ||
              candType.includes('test plan') || candType.includes('testplan') || candType.includes('test set') || candType.includes('plan de prueba') ||
              candType.includes('bug') || candType.includes('defecto') || candType.includes('error') ||
              candType.includes('epic') || candType.includes('épica')
            )) {
              return;
            }
            if (!seenTc.has(cand.key)) {
              seenTc.add(cand.key);
              linkedTestCases.push({
                id: cand.id ? String(cand.id) : null,
                key: cand.key,
                summary: cand.fields?.summary || ''
              });
            }
            const existing = tcMap[cand.key];
            if (!existing || (!existing.epicKey && epicKey)) {
              tcMap[cand.key] = {
                epicKey: epicKey || existing?.epicKey || null,
                epicSummary: epicSummary || existing?.epicSummary || null,
                storyKey: story.key,
                storySummary: story.summary,
                storyStatus: story.status || '',
                storyStatusCategory: story.statusCategory || ''
              };
            }
            if (cand.id) {
              tcMap[String(cand.id)] = tcMap[cand.key];
            }
          }
        });
      }

      story.epicKey = epicKey;
      story.epicSummary = epicSummary;
      story.linkedTestCases = linkedTestCases;

      storyMap[story.key] = {
        key: story.key,
        summary: story.summary,
        status: story.status || '',
        statusCategory: story.statusCategory || '',
        epicKey,
        epicSummary,
        linkedTestCases
      };

      if (epicKey) {
        if (!storiesByEpic[epicKey]) storiesByEpic[epicKey] = [];
        if (!storiesByEpic[epicKey].includes(story.key)) {
          storiesByEpic[epicKey].push(story.key);
        }
      }
    });

    // Also check direct links on Epics
    epics.forEach(epic => {
      if (Array.isArray(epic.issuelinks)) {
        epic.issuelinks.forEach(link => {
          const cand = link.inwardIssue || link.outwardIssue;
          if (cand && cand.key) {
            if (!tcMap[cand.key]) {
              tcMap[cand.key] = {
                epicKey: epic.key,
                epicSummary: epic.summary,
                storyKey: null,
                storySummary: null
              };
            } else if (!tcMap[cand.key].epicKey) {
              tcMap[cand.key].epicKey = epic.key;
              tcMap[cand.key].epicSummary = epic.summary;
            }
            if (cand.id) {
              tcMap[String(cand.id)] = tcMap[cand.key];
            }
          }
        });
      }
    });

    return {
      epics,
      stories,
      storyMap,
      storiesByEpic,
      tcMap
    };
  } catch (err) {
    console.error("getTraceabilityHierarchy exception:", err);
    return { epics: [], stories: [], storyMap: {}, storiesByEpic: {}, tcMap: {} };
  }
});

resolver.define('linkCasesToRequirement', async ({ payload }) => {
  try {
    const { requirementId, testCaseIds, linkType } = payload;
    let actualLinkType = linkType;
    
    if (!actualLinkType || actualLinkType === 'ANY') {
      actualLinkType = 'Relates';
    }

    const results = [];
    for (const testId of testCaseIds) {
      const response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: { name: actualLinkType },
          inwardIssue: { id: String(testId) },
          outwardIssue: { id: String(requirementId) }
        })
      });
      const ok = response.status === 201 || response.status === 200;
      results.push({ testId, success: ok, status: response.status });
    }
    
    return { success: true, results };
  } catch (e) {
    console.error("linkCasesToRequirement exception:", e);
    return { success: false, error: String(e) };
  }
});

resolver.define('linkCaseToFolder', async ({ payload }) => {
  const { caseId, folderId } = payload;
  await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/properties/testops-folder-link`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId })
  });
  return true;
});

// === Test Case Details (BDD / Steps) ===
resolver.define('getTestCaseDetails', async ({ payload }) => {
  const { caseId } = payload;
  if (!caseId) return { type: 'traditional', content: [] };

  try {
    // 1. Try directly fetching testpulse-format from the issue
    let response = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/properties/testpulse-format`);
    if (response.ok) {
      const data = await response.json();
      if (data.value && (data.value.content?.length > 0 || data.value.type)) {
        return data.value;
      }
    }

    // 2. If not found or 404, this issue might be a Test Run. Resolve its parent Test Case.
    const issueRes = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}?properties=testpulse-run-data&fields=summary,issuelinks,description`);
    if (issueRes.ok) {
      const issueData = await issueRes.json();
      const runProp = issueData.properties?.['testpulse-run-data'] || {};
      
      let parentTcKeyOrId = runProp.testCaseId || runProp.testCaseKey;
      
      // Look in issue links
      if (!parentTcKeyOrId && issueData.fields?.issuelinks) {
        for (const link of issueData.fields.issuelinks) {
          const other = link.outwardIssue || link.inwardIssue;
          if (other && String(other.id) !== String(caseId) && String(other.key) !== String(caseId)) {
            const linkPropRes = await api.asUser().requestJira(route`/rest/api/3/issue/${other.id}/properties/testpulse-format`);
            if (linkPropRes.ok) {
              const linkData = await linkPropRes.json();
              if (linkData.value && (linkData.value.content?.length > 0 || linkData.value.type)) {
                return linkData.value;
              }
            }
          }
        }
      }

      // Try parsing key from summary "[Run] CEL-123: ..."
      if (!parentTcKeyOrId && issueData.fields?.summary) {
        const match = issueData.fields.summary.match(/\[Run\]\s*([A-Z0-9_-]+):/i);
        if (match && match[1]) {
          parentTcKeyOrId = match[1];
        }
      }

      if (parentTcKeyOrId && String(parentTcKeyOrId) !== String(caseId)) {
        const tcPropRes = await api.asUser().requestJira(route`/rest/api/3/issue/${parentTcKeyOrId}/properties/testpulse-format`);
        if (tcPropRes.ok) {
          const tcData = await tcPropRes.json();
          if (tcData.value) return tcData.value;
        }
      }
    }
  } catch (err) {
    console.warn('[getTestCaseDetails] Error:', err.message);
  }

  return { type: 'traditional', content: [] };
});

resolver.define('saveTestCaseDetails', async ({ payload }) => {
  const { caseId, details } = payload;
  await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/properties/testpulse-format`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(details)
  });
  return true;
});

resolver.define('getTestCaseDetailsBatch', async ({ payload }) => {
  const { caseIds } = payload;
  if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) return {};
  const results = {};
  await processInBatches(caseIds, 15, 100, async (caseId) => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/properties/testpulse-format`);
      if (response.ok) {
        const data = await response.json();
        if (data.value) results[caseId] = data.value;
      }
    } catch (e) {
      console.warn('[getTestCaseDetailsBatch] Error fetching', caseId, e.message);
    }
  });
  return results;
});

// === Test Set Management ===
resolver.define('createTestSet', async (req) => {
  const { summary, description, projectId, config: payloadConfig } = req.payload || {};
  let config = payloadConfig && typeof payloadConfig === 'object' ? payloadConfig : null;
  if (!config && projectId) {
    try {
      const configResponse = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
      if (configResponse.status === 200) {
        config = (await configResponse.json()).value || {};
      }
    } catch (_) {}
  }
  const setIssueType = config?.planIssueTypeId
    ? { id: String(config.planIssueTypeId) }
    : { name: config?.planIssueType || 'Test Set' };

  const body = {
    fields: {
      summary: summary,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }]
      },
      project: { id: projectId },
      issuetype: setIssueType
    }
  };
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  return await response.json();
});

resolver.define('linkTestToFolder', async ({ payload }) => {
  const { testId, folderId } = payload;
  if (!folderId) {
    try {
      await api.asUser().requestJira(route`/rest/api/3/issue/${testId}/properties/testops-folder-link`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.log('Property might not exist, ignoring delete error', e);
    }
  } else {
    await api.asUser().requestJira(route`/rest/api/3/issue/${testId}/properties/testops-folder-link`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId })
    });
  }
  return true;
});

// === Test Cycle Management ===
resolver.define('createTestCycle', async (req) => {
  const { summary, description, projectId, config: payloadConfig } = req.payload || {};
  
  // Fetch configured testCycleType (primary key: testops-config, legacy fallback: testpulse-config)
  let config = payloadConfig && typeof payloadConfig === 'object' ? payloadConfig : {};
  if (!config.testCycleType && !config.testCycleTypeId && projectId) {
    const configResponse = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
    if (configResponse.status === 200) {
      config = (await configResponse.json()).value || {};
    } else {
      const legacyResponse = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-config`);
      if (legacyResponse.status === 200) {
        config = (await legacyResponse.json()).value || {};
      }
    }
  }
  const cycleType = config?.testCycleType || 'Test Cycle';
  const cycleIssueType = config?.testCycleTypeId
    ? { id: String(config.testCycleTypeId) }
    : { name: cycleType };

  const body = {
    fields: {
      summary: summary,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }]
      },
      project: { id: projectId },
      issuetype: cycleIssueType
    }
  };
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  return await response.json();
});



// Fast initial load endpoint — heals legacy format on the fly
// Lightweight index must stay under Jira's 32KB entity property limit.
// Full bug data (summary, status, assignee, rawFields…) is stored in exec_ properties.
// The index only needs bug keys to render the badge count in the UI.
const trimBugsForIndex = (bugs) => {
  if (!bugs || !Array.isArray(bugs)) return [];
  return bugs.map(b => (typeof b === 'string' ? { key: b } : { key: b.key })).filter(b => b.key);
};


// === Cycle Index — Jira Entity Property sharding (no 32KB limit per shard) ===
// Sharded into blocks of SHARD_SIZE entries (40 entries × ~250 bytes ≈ 10KB, safely under Jira's 32KB limit).
// Shard 0: /properties/execution  (backward compat with existing data)
// Shard N: /properties/execution_N  (N = 1, 2, 3… up to 100 = 4,000+ tests per cycle)
const SHARD_SIZE = 40;
const _shardProp = (shard) => shard === 0 ? 'execution' : `execution_${shard}`;

// Helper: run async tasks with a bounded concurrency (keeps Jira rate limits happy)
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const _shardIndexFromKey = (key) => {
  if (key === 'execution') return 0;
  const m = /^execution_(\d+)$/.exec(key);
  return m ? parseInt(m[1], 10) : -1;
};

// Lists the existing execution shard numbers of a cycle in ONE request (sorted asc).
// Returns null if the listing endpoint failed (caller should fall back to legacy probing).
const listCycleShards = async (cycleId) => {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.keys || [])
      .map(k => _shardIndexFromKey(k.key))
      .filter(n => n >= 0)
      .sort((a, b) => a - b);
  } catch (_) {
    return null;
  }
};

const _fetchShard = async (cycleId, shard) => {
  const propName = _shardProp(shard);
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${propName}`);
    if (res.status === 429) {
      if (attempt === 3) return { error: 429 };
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + Math.random() * 500));
      continue;
    }
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { error: res.status };
    const data = await res.json();
    return { value: data.value };
  }
  return { error: 'max_retries' };
};

const _normalizeShard = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return (typeof raw[0] === 'string')
    ? raw.map(id => ({ id: String(id), status: 'Not Run', linkedBugs: [] }))
    : raw;
};

// Returns:
//   null  → shard 0 does not exist (cycle has never had an index)
//   []    → shard 0 exists with empty array (index was explicitly cleared)
//   [...] → tests in the index
const readCycleIndex = async (cycleId, preloadedShard0 = undefined) => {
  let preloadedEntries = undefined;
  if (preloadedShard0 !== undefined) {
    if (preloadedShard0 === null) {
      return null;
    }
    const rawArr = Array.isArray(preloadedShard0)
      ? preloadedShard0
      : (Array.isArray(preloadedShard0?.value) ? preloadedShard0.value : null);
    if (Array.isArray(rawArr)) {
      if (rawArr.length === 0) return [];
      preloadedEntries = _normalizeShard(rawArr);
      if (rawArr.length < SHARD_SIZE) {
        return preloadedEntries;
      }
    }
  }

  const shards = await listCycleShards(cycleId);

  if (shards === null) {
    // Legacy fallback: sequential probing (only used if the listing endpoint fails)
    const allEntries = preloadedEntries ? [...preloadedEntries] : [];
    const startShard = preloadedEntries ? 1 : 0;
    for (let shard = startShard; shard <= 100; shard++) {
      const r = await _fetchShard(cycleId, shard);
      if (r.missing) { if (shard === 0) return null; break; }
      if (r.error) break;
      const entries = _normalizeShard(r.value);
      if (entries.length === 0) { if (shard === 0) return []; break; }
      allEntries.push(...entries);
    }
    return allEntries;
  }

  if (shards.length === 0 || shards[0] !== 0) return preloadedEntries || null;

  // Only consider the contiguous run 0..N (same semantics as the legacy reader)
  const contiguous = [];
  for (let i = 0; i < shards.length && shards[i] === i; i++) contiguous.push(i);

  if (preloadedEntries) {
    const restShards = contiguous.slice(1);
    if (restShards.length === 0) return preloadedEntries;
    const results = await mapWithConcurrency(restShards, 6, (shard) => _fetchShard(cycleId, shard));
    const allEntries = [...preloadedEntries];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.missing || r.error) break;
      const entries = _normalizeShard(r.value);
      if (entries.length === 0) break;
      allEntries.push(...entries);
    }
    return allEntries;
  }

  const results = await mapWithConcurrency(contiguous, 6, (shard) => _fetchShard(cycleId, shard));
  const allEntries = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.missing || r.error) { if (i === 0) return r.missing ? null : []; break; }
    const entries = _normalizeShard(r.value);
    if (entries.length === 0) { if (i === 0) return []; break; }
    allEntries.push(...entries);
  }
  return allEntries;
};

const _putShard = async (cycleId, shard, shardEntries) => {
  const propName = _shardProp(shard);
  const doPut = () => api.asUser().requestJira(
    route`/rest/api/3/issue/${cycleId}/properties/${propName}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(shardEntries)
    }
  );
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await doPut();
    if (res.status === 429) {
      if (attempt === 3) {
        console.error(`[writeCycleIndex] Shard ${shard} write failed after retries: 429`);
        return false;
      }
      await new Promise(r => setTimeout(r, 1200 * Math.pow(2, attempt) + Math.random() * 600));
      continue;
    }
    if (!res.ok) {
      console.error(`[writeCycleIndex] Shard ${shard} write failed: ${res.status}`);
      return false;
    }
    return true;
  }
  return false;
};

const writeCycleIndex = async (cycleId, entries) => {
  // ALWAYS write at least shard 0, even for empty arrays.
  // An empty shard 0 is the "explicitly cleared" sentinel that prevents
  // getCycleExecutionSummary Tier 2 from resurrecting deleted tests via exec_ scan.
  const cleanEntries = (entries || []).map(e => ({
    id: String(e.id || e.testCaseId || ''),
    key: e.key || e.testCaseKey || '',
    testCaseKey: e.testCaseKey || e.key || '',
    testRunId: e.testRunId || null,
    testRunKey: e.testRunKey || null,
    summary: typeof e.summary === 'string' ? e.summary.slice(0, 160) : '',
    status: e.status || 'Not Run',
    executionType: e.executionType || 'Manual',
    linkedBugs: trimBugsForIndex(e.linkedBugs || [])
  }));

  const shardCount = cleanEntries.length === 0 ? 1 : Math.ceil(cleanEntries.length / SHARD_SIZE);
  const existingShards = await listCycleShards(cycleId);

  // Write shards with bounded parallelism (concurrency 3)
  const shardNums = Array.from({ length: shardCount }, (_, i) => i);
  await mapWithConcurrency(shardNums, 3, (shard) =>
    _putShard(cycleId, shard, cleanEntries.slice(shard * SHARD_SIZE, (shard + 1) * SHARD_SIZE))
  );

  // Lightweight summary used by getTestCycles (avoids reading every shard just to count)
  try {
    const seen = new Set();
    const meta = { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, other: 0, updatedAt: Date.now() };
    for (const e of cleanEntries) {
      const dk = e.testCaseKey ? `k_${e.testCaseKey}` : `i_${e.id}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      meta.total++;
      const st = normalizeJiraStatus(e.status);
      if (st === 'Passed') meta.passed++;
      else if (st === 'Failed') meta.failed++;
      else if (st === 'Blocked') meta.blocked++;
      else if (st === 'Not Run') meta.notRun++;
      else meta.other++;
    }
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution-meta`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    });
  } catch (metaErr) {
    console.warn('[writeCycleIndex] execution-meta write failed:', metaErr?.message);
  }

  // Delete ONLY trailing shards that actually exist (previously fired ~100 blind DELETEs per write)
  const trailing = existingShards === null
    ? Array.from({ length: 101 - shardCount }, (_, i) => shardCount + i)
    : existingShards.filter(n => n >= shardCount);
  if (trailing.length > 0) {
    await mapWithConcurrency(trailing, 3, (shard) =>
      api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${_shardProp(shard)}`, { method: 'DELETE' }).catch(() => null)
    );
  }
};

const deleteCycleIndex = async (cycleId) => {
  const shards = await listCycleShards(cycleId);
  const targets = shards === null ? Array.from({ length: 101 }, (_, i) => i) : shards;
  await mapWithConcurrency(targets, 3, (shard) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${_shardProp(shard)}`, { method: 'DELETE' }).catch(() => null)
  );
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution-meta`, { method: 'DELETE' }).catch(() => null);
};


// Helper: Safely unlinks a Test Run issue from a Cycle issue (without deleting the Test Run)
async function unlinkIssueFromCycle(runIssueId, cycleId) {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${runIssueId}?fields=issuelinks`);
    if (!res.ok) return false;
    const data = await res.json();
    const links = data.fields?.issuelinks || [];
    let unlinkedAny = false;
    for (const link of links) {
      const linked = link.outwardIssue || link.inwardIssue;
      if (linked && (String(linked.id) === String(cycleId) || String(linked.key) === String(cycleId))) {
        await api.asUser().requestJira(route`/rest/api/3/issueLink/${link.id}`, {
          method: 'DELETE'
        }).catch(() => {});
        unlinkedAny = true;
      }
    }
    return unlinkedAny;
  } catch (e) {
    console.warn(`[unlinkIssueFromCycle] Error:`, e.message);
    return false;
  }
}

async function createTestRunsInJiraForCycle({ projectId, cycleId, cycleKey, testCases, config, skipCandidateSearch = false }) {
  const testRunType = config?.testRunType || 'Test Run';
  if (!testCases || testCases.length === 0) return [];

  let targetProjectId = projectId;
  if (!targetProjectId) {
    try {
      const cycleRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}?fields=project,key`);
      if (cycleRes.ok) {
        const cycleData = await cycleRes.json();
        targetProjectId = cycleData.fields?.project?.id;
        if (!cycleKey) cycleKey = cycleData.key;
      }
    } catch (e) {
      console.warn(`[createTestRunsInJiraForCycle] Error fetching cycle ${cycleId}:`, e.message);
    }
  }

  const createdRuns = [];
  const testCasesToCreate = [];

  if (skipCandidateSearch) {
    testCasesToCreate.push(...testCases);
  } else {
    // Step 1: Check for existing Test Runs in Jira for this cycle & test cases (Auto-Recovery)
    try {
      // 1. Fetch runs currently linked to the cycle
      let candidateRuns = await fetchAllIssues(
        `issue in linkedIssues(${jqlQuote(cycleId)})`,
        getRunCandidateJqlFields(config),
        null,
        ['testpulse-run-data'],
        50
      );
      if (!Array.isArray(candidateRuns)) candidateRuns = [];

      // 2. Fetch unlinked runs attached to the specific test cases being added
      const tcIdentifiers = testCases.map(tc => tc.id || tc.key).filter(Boolean);
      const chunks = [];
      for (let i = 0; i < tcIdentifiers.length; i += 25) {
        chunks.push(tcIdentifiers.slice(i, i + 25));
      }

      const tcLinkedRunsArray = await Promise.all(chunks.map(async (chunk) => {
        const jql = chunk.map(id => `issue in linkedIssues(${jqlQuote(id)})`).join(' OR ');
        return await fetchAllIssues(
          `(${jql})`,
          getRunCandidateJqlFields(config),
          null,
          ['testpulse-run-data'],
          50
        ).catch(() => []);
      }));

      const candidateMap = new Map();
      for (const r of candidateRuns) {
        if (r && r.id) candidateMap.set(String(r.id), r);
      }
      for (const list of tcLinkedRunsArray) {
        for (const r of (list || [])) {
          if (r && r.id) candidateMap.set(String(r.id), r);
        }
      }
      candidateRuns = Array.from(candidateMap.values());

      for (const tc of testCases) {
        const tcIdStr = String(tc.id);
        const tcKeyStr = tc.key ? String(tc.key) : '';

        // Find if an existing run matches this test case and this cycle
        const existingRun = candidateRuns.find(r => {
          if (String(r.id) === String(cycleId) || String(r.key) === String(cycleId)) return false;
          if (String(r.id) === tcIdStr || String(r.key) === tcKeyStr) return false;

          const prop = r.properties?.['testpulse-run-data'] || {};
          const matchesCycle = String(prop.cycleId) === String(cycleId) || prop.cycleKey === String(cycleKey);

          // Check if this run belongs to this test case
          const matchesTcProp = String(prop.testCaseId) === tcIdStr || (tcKeyStr && prop.testCaseKey === tcKeyStr);
          const matchesSummary = Boolean(tcKeyStr && r.fields?.summary && (r.fields.summary.includes(`[Run] ${tcKeyStr}:`) || r.fields.summary.includes(tcKeyStr)));

          let matchesLinks = false;
          const links = r.fields?.issuelinks || [];
          for (const l of links) {
            const linked = l.outwardIssue || l.inwardIssue;
            if (linked && (String(linked.id) === tcIdStr || (tcKeyStr && String(linked.key) === tcKeyStr))) {
              matchesLinks = true;
              break;
            }
          }

          return (matchesCycle || !prop.cycleId) && (matchesTcProp || matchesLinks || matchesSummary);
        });

        if (existingRun) {
          // RECONECTAR / AUTO-RECUPERAR EL RUN EXISTENTE EN LUGAR DE CREAR UNO NUEVO
          try {
            await linkTwoIssues(existingRun.id, cycleId, 'Relates');
            if (tc.id) {
              await linkTwoIssues(existingRun.id, tc.id, 'Relates');
            }

            const existingProp = existingRun.properties?.['testpulse-run-data'] || {};
            const updatedProp = {
              ...existingProp,
              cycleId: String(cycleId),
              cycleKey: cycleKey || String(cycleId),
              testCaseId: tcIdStr,
              testCaseKey: tcKeyStr || existingProp.testCaseKey || '',
              unlinkedFromCycle: false
            };
            delete updatedProp.unlinkedAt;

            await api.asUser().requestJira(route`/rest/api/3/issue/${existingRun.id}/properties/testpulse-run-data`, {
              method: 'PUT',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedProp)
            });

            const nativeStatus = existingRun.fields?.status?.name || 'Not Run';
            const normStatus = normalizeJiraStatus(nativeStatus || existingProp.status || 'Not Run');

            createdRuns.push({
              id: tcIdStr,
              key: tcKeyStr || existingRun.key,
              testRunId: existingRun.id,
              testRunKey: existingRun.key,
              testCaseId: tcIdStr,
              testCaseKey: tcKeyStr || existingRun.key,
              summary: existingProp.snapshot?.testCaseSummary || tc.summary,
              description: existingRun.fields?.description || existingProp.snapshot?.testCaseDescription || null,
              executionType: existingProp.executionType || tc.executionType || 'Manual',
              status: normStatus,
              nativeStatus: nativeStatus,
              assignee: existingRun.fields?.assignee || null,
              executedBy: existingProp.executedBy || (existingRun.fields?.assignee ? { displayName: existingRun.fields.assignee.displayName, accountId: existingRun.fields.assignee.accountId } : null),
              executedAt: existingProp.executedAt || null,
              evidences: filterNonIterationEvidences([
                ...(existingRun.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
                ...(existingProp.evidences || [])
              ], getIterationEvidenceKeys(existingProp.iterations)),
              iterations: existingProp.iterations || [],
              comment: existingProp.comment || '',
              linkedBugs: existingProp.linkedBugs || [],
              isRecovered: true
            });
            continue;
          } catch (recoverErr) {
            console.warn(`[createTestRunsInJiraForCycle] Error recovering run ${existingRun.id}:`, recoverErr.message);
          }
        }

        // No existing run to recover: needs fresh creation
        testCasesToCreate.push(tc);
      }
    } catch (searchErr) {
      console.warn(`[createTestRunsInJiraForCycle] Error searching candidates:`, searchErr.message);
      testCasesToCreate.push(...testCases.filter(tc => !createdRuns.some(cr => String(cr.id) === String(tc.id))));
    }
  }

  // Step 2: Fresh creation for test cases that did not have prior executions
  if (testCasesToCreate.length > 0) {
    const snapshots = await mapWithConcurrency(testCasesToCreate, 3, tc => getTestCaseSnapshot(tc.id || tc.key));

    const issueUpdates = testCasesToCreate.map((tc, idx) => {
      const tcSnapshot = snapshots[idx];
      const adfDesc = ensureValidAdf(tcSnapshot?.description, `Snapshot del caso ${tc.key || tc.id}: ${tc.summary || ''}`);
      return {
        fields: {
          project: { id: String(targetProjectId) },
          summary: `[Run] ${tc.key || tc.id}: ${tc.summary || 'Test Case'}`.substring(0, 255),
          issuetype: { name: testRunType },
          description: adfDesc
        }
      };
    });

    let bulkCreatedIssues = [];
    try {
      let bulkRes = await api.asUser().requestJira(route`/rest/api/3/issue/bulk`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueUpdates })
      });

      if (!bulkRes.ok && testRunType !== 'Task') {
        // Fallback to Task if testRunType fails
        issueUpdates.forEach(u => { u.fields.issuetype = { name: 'Task' }; });
        bulkRes = await api.asUser().requestJira(route`/rest/api/3/issue/bulk`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueUpdates })
        });
      }

      if (bulkRes.ok) {
        const bulkData = await bulkRes.json();
        bulkCreatedIssues = bulkData.issues || [];
      } else {
        const errText = await bulkRes.text();
        console.warn(`[createTestRunsInJiraForCycle] Bulk create failed: ${bulkRes.status} ${errText}, falling back to single creations`);
      }
    } catch (bulkErr) {
      console.warn(`[createTestRunsInJiraForCycle] Bulk create exception:`, bulkErr.message);
    }

    // Process created issues (or fallback if bulk creation was incomplete)
    const runProcessingPromises = testCasesToCreate.map(async (tc, idx) => {
      const tcSnapshot = snapshots[idx];
      let runIssue = bulkCreatedIssues[idx];

      // Fallback if bulk create didn't return this issue
      if (!runIssue || !runIssue.id) {
        const adfDesc = ensureValidAdf(tcSnapshot?.description, `Snapshot del caso ${tc.key || tc.id}: ${tc.summary || ''}`);
        const singlePayload = {
          fields: {
            project: { id: String(targetProjectId) },
            summary: `[Run] ${tc.key || tc.id}: ${tc.summary || 'Test Case'}`.substring(0, 255),
            issuetype: { name: testRunType },
            description: adfDesc
          }
        };
        try {
          let sRes = await api.asUser().requestJira(route`/rest/api/3/issue`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(singlePayload)
          });
          if (!sRes.ok && testRunType !== 'Task') {
            singlePayload.fields.issuetype = { name: 'Task' };
            sRes = await api.asUser().requestJira(route`/rest/api/3/issue`, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(singlePayload)
            });
          }
          if (sRes.ok) {
            runIssue = await sRes.json();
          }
        } catch (sErr) {
          console.warn(`[createTestRunsInJiraForCycle] Single fallback error for ${tc.id}:`, sErr.message);
        }
      }

      if (!runIssue || !runIssue.id) return null;

      try {
        const executionType = tcSnapshot?.executionType || tc.executionType || 'Manual';
        const runData = {
          testCaseId: String(tc.id),
          testCaseKey: tc.key || '',
          cycleId: String(cycleId),
          cycleKey: cycleKey || String(cycleId),
          executionType: executionType,
          status: 'Not Run',
          iterations: [],
          comment: '',
          executedBy: null,
          executedAt: null,
          evidences: [],
          snapshot: {
            testCaseId: tc.id,
            testCaseKey: tc.key,
            testCaseSummary: tc.summary,
            testCaseDescription: tcSnapshot?.renderedDescription || null,
            executionType: executionType,
            capturedAt: Date.now()
          }
        };

        // 1. Primary link: Link Test Run to Cycle (with retries)
        await linkTwoIssues(runIssue.id, cycleId, 'Relates');

        // 2. Set Test Run metadata property
        await api.asUser().requestJira(route`/rest/api/3/issue/${runIssue.id}/properties/testpulse-run-data`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(runData)
        }).catch(() => {});

        // 3. Secondary link: Link Test Run to Test Case
        if (tc.id) {
          await linkTwoIssues(runIssue.id, tc.id, 'Relates');
        }

        return {
          id: String(tc.id),
          key: runIssue.key,
          testRunId: runIssue.id,
          testRunKey: runIssue.key,
          testCaseId: String(tc.id),
          testCaseKey: tc.key,
          summary: tc.summary,
          description: tcSnapshot?.renderedDescription || null,
          executionType: executionType,
          status: 'Not Run'
        };
      } catch (errItem) {
        console.warn(`[createTestRunsInJiraForCycle] Error linking/setting property for ${tc.id}:`, errItem.message);
        return null;
      }
    });

    const settledRuns = await Promise.all(runProcessingPromises);
    settledRuns.forEach(r => {
      if (r) createdRuns.push(r);
    });
  }

  // Stamp testpulse-v2 on cycle
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testpulse-v2`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, migratedAt: Date.now() })
  }).catch(() => {});

  return createdRuns;
}

const _cycleSummaryInFlight = new Map();

const getCycleExecutionSummary = async (cycleId) => {
  const inflightKey = String(cycleId || '');
  if (inflightKey && _cycleSummaryInFlight.has(inflightKey)) {
    return _cycleSummaryInFlight.get(inflightKey);
  }
  const runSummary = async () => {
  try {
    // 1. Fetch native Test Runs linked to this cycle in real time via JQL
    const jql = `issue in linkedIssues(${jqlQuote(cycleId)})`;
    const runIssues = await fetchAllIssues(
      jql,
      getRunCandidateJqlFields(),
      null,
      ['testpulse-run-data'],
      50
    );

    if (Array.isArray(runIssues) && runIssues.length > 0) {
      const validRuns = runIssues.filter(run => {
        const prop = run.properties?.['testpulse-run-data'] || {};
        // 1. Strict Ghost Prevention: If explicitly marked unlinked from this cycle, discard
        if (prop.unlinkedFromCycle === true) return false;

        // 2. Strict Ghost Prevention: Verify that Jira issue links actually contain this cycleId/cycleKey
        const links = run.fields?.issuelinks || [];
        const isLinkedToCycle = links.some(l => {
          const target = l.outwardIssue || l.inwardIssue;
          return target && (String(target.id) === String(cycleId) || String(target.key) === String(cycleId));
        });
        const type = run.fields?.issuetype?.name || '';
        const isDirectTc = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba'].some(t => type.toLowerCase().includes(t.toLowerCase()));
        
        // If Jira returns issuelinks and none link to this cycle, it was already unlinked (Jira JQL index lag)
        if (Array.isArray(links) && links.length > 0 && !isLinkedToCycle && !isDirectTc) {
          return false;
        }

        const summary = run.fields?.summary || '';
        const isRunType = ['Test Run', 'TestRun', 'Ejecución de prueba', 'Ejecución', 'Test Execution'].some(t => type.toLowerCase().includes(t.toLowerCase()));
        const isTcType = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba', 'Test', 'Tarea', 'Task'].some(t => type.toLowerCase().includes(t.toLowerCase()));
        return (prop && Object.keys(prop).length > 0) || summary.startsWith('[Run]') || isRunType || isTcType;
      });

      if (validRuns.length > 0) {
        // Map each run to its resolved tcId/tcKey and full data object
        const mappedRuns = validRuns.map(run => {
          const runData = run.properties?.['testpulse-run-data'] || {};
          const type = run.fields?.issuetype?.name || '';
          const isDirectTc = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba'].some(t => type.toLowerCase().includes(t.toLowerCase()));

          let tcKey = runData.testCaseKey || (isDirectTc ? run.key : '');
          if (!tcKey && run.fields?.summary) {
            const match = run.fields.summary.match(/\[Run\]\s*([A-Z0-9_-]+):/i);
            if (match && match[1]) tcKey = match[1];
          }
          if (!tcKey) {
            const linkedTc = (run.fields?.issuelinks || [])
              .map(l => l.outwardIssue || l.inwardIssue)
              .filter(Boolean)
              .find(i => {
                const typeName = (i.fields?.issuetype?.name || '').toLowerCase();
                return String(i.id) !== String(cycleId) && (typeName.includes('test') || typeName.includes('caso') || typeName.includes('prueba'));
              });
            if (linkedTc) tcKey = linkedTc.key;
          }
          if (!tcKey) tcKey = run.key;

          let tcId = runData.testCaseId || (isDirectTc ? String(run.id) : '');
          if (!tcId) {
            const linkedTc = (run.fields?.issuelinks || [])
              .map(l => l.outwardIssue || l.inwardIssue)
              .filter(Boolean)
              .find(i => {
                const typeName = (i.fields?.issuetype?.name || '').toLowerCase();
                return String(i.id) !== String(cycleId) && (typeName.includes('test') || typeName.includes('caso') || typeName.includes('prueba'));
              });
            if (linkedTc) tcId = String(linkedTc.id);
          }
          if (!tcId) tcId = (tcKey && tcKey !== run.key) ? tcKey : String(run.id);

          const nativeStatusName = run.fields?.status?.name || '';
          const normNativeStatus = normalizeJiraStatus(nativeStatusName);
          const runDataStatus = runData.status ? normalizeJiraStatus(runData.status) : null;
          
          // Status Resolution:
          // 1. If explicit execution in Test Pulse, preserve TP status
          // 2. If TP is Not Run or unexecuted, fallback to live Jira native status
          let normStatus = 'Not Run';
          const hasTpExplicitExec = runDataStatus && runDataStatus !== 'Not Run' && (runData.executedBy || (runData.evidences && runData.evidences.length > 0) || (runData.iterations && runData.iterations.length > 0) || ['Passed', 'Failed', 'Blocked'].includes(runDataStatus));

          if (hasTpExplicitExec) {
            normStatus = runDataStatus;
          } else if (normNativeStatus && normNativeStatus !== 'Not Run') {
            normStatus = normNativeStatus;
          } else if (runDataStatus) {
            normStatus = runDataStatus;
          } else if (normNativeStatus) {
            normStatus = normNativeStatus;
          }

          const runDesc = run.fields?.description;
          // Live Jira description wins (so manual edits on the Test Run are reflected);
          // the frozen snapshot is only a fallback for empty/generic run descriptions.
          const runDescText = !runDesc ? '' : (typeof runDesc === 'string' ? runDesc : JSON.stringify(runDesc));
          const isEmptyAdf = runDesc && typeof runDesc === 'object' && (!Array.isArray(runDesc.content) || runDesc.content.length === 0);
          const isGenericDesc = !runDesc || isEmptyAdf || runDescText.includes('Test Run execution for test case') || runDescText.includes('Snapshot del caso');
          const effectiveDesc = (!isGenericDesc ? runDesc : null) || runData.snapshot?.testCaseDescription || null;

          return {
            _runIssue: run,
            _tcIdStr: String(tcId),
            _normStatus: normStatus,
            _hasExecution: normStatus !== 'Not Run' || (runData.executedBy) || ((runData.evidences || []).length > 0) || ((runData.iterations || []).length > 0),
            _createdAt: run.fields?.created ? new Date(run.fields.created).getTime() : 0,
            id: String(tcId),
            key: tcKey || run.key,
            testRunId: run.id,
            testRunKey: run.key,
            testCaseId: String(tcId),
            testCaseKey: tcKey || run.key,
            summary: runData.snapshot?.testCaseSummary || (run.fields?.summary ? run.fields.summary.replace(/^\[Run\]\s*([A-Z0-9_-]+:\s*)?/i, '') : ''),
            rawSummary: run.fields?.summary || '',
            description: effectiveDesc,
            status: normStatus,
            nativeStatus: nativeStatusName || normStatus,
            executionType: runData.executionType || runData.snapshot?.executionType || extractExecutionTypeFromFields(run.fields),
            assignee: run.fields?.assignee || null,
            executedBy: runData.executedBy || (run.fields?.assignee ? { displayName: run.fields.assignee.displayName, accountId: run.fields.assignee.accountId } : null),
            executedAt: runData.executedAt || null,
            evidences: filterNonIterationEvidences([
              ...(run.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
              ...(runData.evidences || [])
            ], getIterationEvidenceKeys(runData.iterations)),
            iterations: runData.iterations || [],
            comment: runData.comment || '',
            // Validate linkedBugs against live Jira issue links and cycle project prefix
            linkedBugs: (() => {
              const runProjPrefix = (run.key && run.key.includes('-')) ? run.key.split('-')[0].toUpperCase() : '';
              const rawLinks = (run.fields?.issuelinks || [])
                .filter(l => l.type?.name === 'Blocks' || l.outwardIssue?.fields?.issuetype?.name?.toLowerCase().includes('bug') || l.inwardIssue?.fields?.issuetype?.name?.toLowerCase().includes('bug'))
                .map(l => {
                  const linked = l.outwardIssue || l.inwardIssue;
                  return {
                    key: linked?.key,
                    summary: linked?.fields?.summary,
                    status: linked?.fields?.status?.name,
                    priority: linked?.fields?.priority?.name
                  };
                })
                .filter(b => !!b.key && (!runProjPrefix || String(b.key).toUpperCase().startsWith(runProjPrefix + '-')));
              const sourceBugs = (runData.linkedBugs && runData.linkedBugs.length > 0) ? runData.linkedBugs : rawLinks;
              return sourceBugs.filter(b => b && b.key && (!runProjPrefix || String(b.key).toUpperCase().startsWith(runProjPrefix + '-')));
            })(),
            lockedAt: runData.lockedAt || null,
            _detailLoaded: false
          };
        });

        // In-memory deduplication: group by unique test case, keep best run without deleting anything in Jira
        const byKey = new Map();
        for (const entry of mappedRuns) {
          const tcKey = entry.testCaseKey || entry.key;
          const tcId = entry.testCaseId || entry.id;
          const lookupKey = tcKey ? `key_${tcKey}` : `id_${tcId}`;

          if (!byKey.has(lookupKey)) {
            byKey.set(lookupKey, entry);
          } else {
            const existing = byKey.get(lookupKey);
            const existingWins = existing._hasExecution || (!entry._hasExecution && existing._createdAt >= entry._createdAt);
            const winner = existingWins ? existing : entry;
            byKey.set(lookupKey, winner);
          }
        }

        const uniqueEntries = Array.from(new Set(byKey.values()));
        const cleanEntries = uniqueEntries.map(entry => {
          const { _runIssue, _tcIdStr, _normStatus, _hasExecution, _createdAt, ...clean } = entry;
          return clean;
        });

        // Merge with stored index so any tests created/added before Jira JQL indexes them are not dropped
        const previousIndex = (await readCycleIndex(cycleId)) || [];
        const knownIds = new Set(cleanEntries.flatMap(e => [
          String(e.id || ''),
          String(e.testCaseId || ''),
          String(e.key || ''),
          String(e.testCaseKey || ''),
          String(e.testRunId || ''),
          String(e.testRunKey || '')
        ]).filter(Boolean));

        for (const prev of previousIndex) {
          const prevId = String(prev.id || '');
          const prevKey = String(prev.key || prev.testCaseKey || '');
          const prevRunId = String(prev.testRunId || '');
          const prevRunKey = String(prev.testRunKey || '');

          if (prevId && !knownIds.has(prevId) && (!prevKey || !knownIds.has(prevKey)) && (!prevRunId || !knownIds.has(prevRunId)) && (!prevRunKey || !knownIds.has(prevRunKey))) {
            cleanEntries.push({
              id: prevId,
              key: prevKey || prevId,
              testRunId: prev.testRunId || null,
              testRunKey: prev.testRunKey || null,
              testCaseId: prevId,
              testCaseKey: prevKey || prevId,
              summary: prev.summary || '',
              status: normalizeJiraStatus(prev.status || 'Not Run'),
              nativeStatus: normalizeJiraStatus(prev.nativeStatus || prev.status || 'Not Run'),
              executionType: prev.executionType || 'Manual',
              assignee: prev.assignee || null,
              executedBy: prev.executedBy || null,
              executedAt: prev.executedAt || null,
              comment: prev.comment || '',
              iterations: prev.iterations || [],
              evidences: filterNonIterationEvidences(prev.evidences || [], getIterationEvidenceKeys(prev.iterations)),
              linkedBugs: prev.linkedBugs || [],
              lockedAt: prev.lockedAt || null,
              _detailLoaded: true
            });
            knownIds.add(prevId);
            if (prevKey) knownIds.add(prevKey);
            if (prevRunId) knownIds.add(prevRunId);
            if (prevRunKey) knownIds.add(prevRunKey);

            // Auto-heal missing Jira issue link to cycle
            const targetRunRef = prev.testRunId || prev.testRunKey;
            if (targetRunRef) {
              await linkTwoIssues(targetRunRef, cycleId, 'Relates').catch(() => {});
            }
          }
        }

        // Verify any linkedBugs in this cycle against live Jira (purges bugs moved to another project or deleted)
        const cycleBugKeys = new Set();
        let cycleProjPrefix = (typeof cycleId === 'string' && cycleId.includes('-')) ? cycleId.split('-')[0].toUpperCase() : '';
        cleanEntries.forEach(e => {
          if (!cycleProjPrefix) {
            const sampleKey = e.testRunKey || e.testCaseKey || e.key || '';
            if (sampleKey && sampleKey.includes('-')) cycleProjPrefix = sampleKey.split('-')[0].toUpperCase();
          }
          (e.linkedBugs || []).forEach(b => {
            if (b && b.key) cycleBugKeys.add(b.key);
          });
        });
        if (cycleBugKeys.size > 0) {
          const validCycleBugs = await fetchBugsBatch(Array.from(cycleBugKeys), config, null, cycleProjPrefix || null);
          cleanEntries.forEach(e => {
            if (Array.isArray(e.linkedBugs) && e.linkedBugs.length > 0) {
              e.linkedBugs = e.linkedBugs
                .filter(b => b && b.key && validCycleBugs[b.key])
                .map(b => {
                  const { rawFields: _rf, ...leanBug } = validCycleBugs[b.key];
                  return { ...b, ...leanBug };
                });
            }
          });
        }

        // Reconcile cycle sharded index ONLY if the compact snapshot actually changed,
        // avoiding redundant Jira issue property PUT writes on every cycle read/open.
        const toCompactEntry = (e) => ({
          id: String(e.id || ''),
          key: e.key || e.testCaseKey || '',
          testCaseKey: e.testCaseKey || e.key || '',
          testRunId: e.testRunId || null,
          testRunKey: e.testRunKey || null,
          summary: e.summary || '',
          status: normalizeJiraStatus(e.status || 'Not Run'),
          nativeStatus: normalizeJiraStatus(e.nativeStatus || e.status || 'Not Run'),
          executionType: e.executionType || 'Manual',
          linkedBugs: trimBugsForIndex(e.linkedBugs || [])
        });
        const nextCompact = cleanEntries.map(toCompactEntry);
        const prevCompact = (Array.isArray(previousIndex) ? previousIndex : []).map(toCompactEntry);
        if (JSON.stringify(nextCompact) !== JSON.stringify(prevCompact)) {
          await writeCycleIndex(cycleId, nextCompact).catch(() => {});
        }

        return cleanEntries;
      }
    }

    // If runIssues is an empty array or validRuns is empty:
    // Fall back to stored cycle index safely without purging
    const previousIndex = (await readCycleIndex(cycleId)) || [];
    return previousIndex.map(entry => ({
      id: String(entry.id),
      key: entry.key || entry.testCaseKey || '',
      testRunId: entry.testRunId,
      testRunKey: entry.testRunKey,
      testCaseId: String(entry.id),
      testCaseKey: entry.key || entry.testCaseKey || '',
      summary: entry.summary || '',
      status: normalizeJiraStatus(entry.status || 'Not Run'),
      nativeStatus: normalizeJiraStatus(entry.status || 'Not Run'),
      executionType: entry.executionType || 'Manual',
      assignee: entry.assignee || null,
      executedBy: entry.executedBy || null,
      executedAt: entry.executedAt || null,
      comment: entry.comment || '',
      iterations: entry.iterations || [],
      evidences: filterNonIterationEvidences(entry.evidences || [], getIterationEvidenceKeys(entry.iterations)),
      linkedBugs: entry.linkedBugs || [],
      lockedAt: entry.lockedAt || null,
      _detailLoaded: true
    }));
  } catch (err) {
    console.error('[getCycleExecutionSummary] Unexpected error:', err.message);
    const entries = (await readCycleIndex(cycleId)) || [];
    return entries.map(entry => ({
      id: String(entry.id),
      key: entry.key || entry.testCaseKey || '',
      testRunId: entry.testRunId,
      testRunKey: entry.testRunKey,
      testCaseId: String(entry.id),
      testCaseKey: entry.key || entry.testCaseKey || '',
      summary: entry.summary || '',
      status: normalizeJiraStatus(entry.status || 'Not Run'),
      nativeStatus: normalizeJiraStatus(entry.status || 'Not Run'),
      executionType: entry.executionType || 'Manual',
      assignee: entry.assignee || null,
      executedBy: entry.executedBy || null,
      executedAt: entry.executedAt || null,
      comment: entry.comment || '',
      iterations: entry.iterations || [],
      evidences: filterNonIterationEvidences(entry.evidences || [], getIterationEvidenceKeys(entry.iterations)),
      linkedBugs: entry.linkedBugs || [],
      lockedAt: entry.lockedAt || null,
      _detailLoaded: true
    }));
  }
  };

  const p = runSummary().finally(() => {
    if (inflightKey) _cycleSummaryInFlight.delete(inflightKey);
  });
  if (inflightKey) _cycleSummaryInFlight.set(inflightKey, p);
  return p;
};


const updateLightweightIndex = async (cycleId, updateFn) => {
    // readCycleIndex returns null (no index), [] (cleared), or [...entries]
    let lightWeight = await readCycleIndex(cycleId);
    lightWeight = updateFn(lightWeight ?? []); // null → [] for updateFn
    lightWeight = lightWeight.map(item => ({ ...item, linkedBugs: trimBugsForIndex(item.linkedBugs) }));
    await writeCycleIndex(cycleId, lightWeight);
};


const fetchBugsBatch = async (keys = [], config = null, projectId = null, projectKey = null) => {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (uniqueKeys.length === 0) return {};
  const requestedSet = new Set(uniqueKeys.map(k => String(k).trim().toUpperCase()));
  const targetProjId = projectId ? String(projectId).trim() : null;
  const targetProjKey = projectKey ? String(projectKey).trim().toUpperCase() : null;
  const bugMap = {};
  const fieldsToFetch = getBugJqlFields(config, ['project']);

  // Chunk into groups of 50 keys to stay well within Jira JQL URL/payload limits
  const CHUNK_SIZE = 50;
  for (let i = 0; i < uniqueKeys.length; i += CHUNK_SIZE) {
    const chunk = uniqueKeys.slice(i, i + CHUNK_SIZE);
    try {
      const jql = `key in (${chunk.map(k => jqlQuote(k)).join(',')})`;
      let resp = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          fields: fieldsToFetch,
          expand: 'changelog',
          maxResults: chunk.length
        })
      });
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1200));
        resp = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jql,
            fields: fieldsToFetch,
            expand: 'changelog',
            maxResults: chunk.length
          })
        });
      }
      if (resp.ok) {
        const data = await resp.json();
        const issues = data.issues || [];
        for (const issue of issues) {
          const key = issue.key;
          const upperKey = String(key || '').trim().toUpperCase();
          // 1. If the issue was moved in Jira, its current key will differ from the requested key.
          // Reject any issue whose current key is not in the requested set.
          if (!requestedSet.has(upperKey)) {
            continue;
          }
          // 2. Verify the issue still belongs to the current project (if projectId / projectKey provided)
          const issueProjId = issue.fields?.project?.id ? String(issue.fields.project.id).trim() : '';
          const issueProjKey = issue.fields?.project?.key ? String(issue.fields.project.key).trim().toUpperCase() : '';
          if (targetProjKey && issueProjKey && issueProjKey !== targetProjKey) {
            continue;
          }
          if (targetProjKey && !upperKey.startsWith(targetProjKey + '-')) {
            continue;
          }
          if (targetProjId && issueProjId && issueProjKey && issueProjId !== targetProjId && issueProjKey !== targetProjId.toUpperCase()) {
            continue;
          }

          const sevVal = extractBugSeverityFromFields(issue.fields, config);

          const affectsVersions = (issue.fields?.versions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
          const fixVersions = (issue.fields?.fixVersions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
          const versionDisplay = fixVersions.length > 0 ? fixVersions.join(', ') : (affectsVersions.length > 0 ? affectsVersions.join(', ') : 'Sin versión');
          const estResDate = extractBugEstimatedDateFromFields(issue.fields, config, false);
          const changelogMeta = analyzeBugChangelog(issue);

          bugMap[key] = {
            key,
            project: issueProjKey || undefined,
            summary: issue.fields?.summary || '',
            status: issue.fields?.status?.name || '',
            statusCategory: issue.fields?.status?.statusCategory?.key || '',
            assignee: issue.fields?.assignee?.displayName || 'Sin asignar',
            resolution: issue.fields?.resolution?.name || 'Unresolved',
            priority: issue.fields?.priority?.name || '',
            issuetype: issue.fields?.issuetype?.name || 'Bug',
            severity: sevVal,
            created: issue.fields?.created || null,
            resolutiondate: issue.fields?.resolutiondate || changelogMeta.lastTerminalAt || null,
            duedate: estResDate,
            estimatedResolutionDate: estResDate,
            versions: affectsVersions,
            fixVersions: fixVersions,
            version: versionDisplay,
            ...changelogMeta,
            rawFields: {
              created: issue.fields?.created || null,
              resolutiondate: issue.fields?.resolutiondate || changelogMeta.lastTerminalAt || null,
              duedate: estResDate,
              status: issue.fields?.status ? { name: issue.fields.status.name } : undefined,
              resolution: issue.fields?.resolution ? { name: issue.fields.resolution.name } : undefined,
              issuetype: issue.fields?.issuetype ? { name: issue.fields.issuetype.name } : undefined,
              versions: affectsVersions,
              fixVersions: fixVersions,
              customfield_10238: sevVal !== 'Sin definir' ? sevVal : undefined
            }
          };
        }
      }
    } catch (err) {
      console.error('[fetchBugsBatch] Bulk JQL error for chunk:', err);
    }
  }
  return bugMap;
};

resolver.define('getExecutionReport', async ({ payload }) => {
  const { projectId, config, limit = 8, offset = 0, fetchAll = false, forceRefresh = false } = payload || {};
  const cycleType = config?.testCycleType || 'Test Cycle';
  const numLimit = typeof limit === 'number' && limit > 0 ? limit : 8;
  const numOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;
  if (forceRefresh) {
    await invalidateProjectReportCache(projectId || null);
  }
  const reportCacheKey = `${projectId || 'ALL'}_${numOffset}_${numLimit}_${fetchAll ? '1' : '0'}_${cycleType}`;
  return await getCachedExecutionReport(reportCacheKey, projectId, async () => {
  const cycleTypes = Array.from(new Set([cycleType, 'Test Cycle', 'Ciclo de Pruebas', 'Ciclo de Prueba'])).map(t => jqlQuote(t)).join(', ');
  
  const jql = `project = ${jqlQuote(projectId)} AND issuetype in (${cycleTypes}) ORDER BY created DESC`;
  let allIssues = [];
  let token = null;
  let isLast = false;
  while (!isLast) {
    const page = await fetchJqlPage(
      jql,
      ['summary', 'issuetype', 'versions', 'fixVersions', 'status', 'created', 'parent'],
      null,
      ['testops-plan-link', 'testpulse-schedule', 'testpulse-v2', 'execution', 'execution-meta'],
      token,
      100
    );
    if (page.error) break;
    allIssues = allIssues.concat(page.issues);
    token = page.nextPageToken;
    isLast = page.isLast;
    if (!token || allIssues.length >= 500) break;
  }

  const extractCyclePlanAndSchedule = (issue) => {
    const properties = issue?.properties || {};
    const planLink = properties['testops-plan-link'];
    const rawSchedProp = properties['testpulse-schedule'];
    const tpV2Prop = properties['testpulse-v2'];
    const tpV2Val = (tpV2Prop && typeof tpV2Prop === 'object')
      ? (tpV2Prop.value && typeof tpV2Prop.value === 'object' ? tpV2Prop.value : tpV2Prop)
      : null;
    const directSched = (rawSchedProp && typeof rawSchedProp === 'object')
      ? (rawSchedProp.value && typeof rawSchedProp.value === 'object' ? rawSchedProp.value : rawSchedProp)
      : null;
    let planId = (planLink && typeof planLink === 'object')
      ? (planLink.planId || planLink.value?.planId || null)
      : (typeof planLink === 'string' ? planLink : (tpV2Val?.planId || null));
    if (!planId && issue?.fields?.parent?.id) {
      planId = issue.fields.parent.id;
    }
    const schedule = (directSched && (directSched.startDate || directSched.endDate || directSched.holidays || directSched.environment))
      ? directSched
      : ((planLink && typeof planLink === 'object' && (planLink.schedule || planLink.value?.schedule))
        ? (planLink.schedule || planLink.value?.schedule)
        : (tpV2Val?.schedule || directSched || null));
    return { planId: planId ? String(planId) : null, schedule };
  };

  const targetIssues = fetchAll ? allIssues : allIssues.slice(numOffset, numOffset + numLimit);
  const hasMore = !fetchAll && (numOffset + numLimit < allIssues.length);
  const nextOffset = numOffset + numLimit;
  
  const cycles = await mapWithConcurrency(targetIssues, 4, async (issue) => {
    const { planId, schedule } = extractCyclePlanAndSchedule(issue);
    const preloadedShard0 = issue.properties ? (issue.properties['execution'] ?? null) : undefined;
    let rawExecution = (await readCycleIndex(issue.id, preloadedShard0)) ?? [];
    
    // Deduplicate by test case key and ID so count strictly matches Planning & Execution
    const seenTc = new Set();
    const execution = [];
    for (let i = 0; i < rawExecution.length; i++) {
      const item = rawExecution[i];
      const tcKey = item.key || item.testCaseKey || '';
      const tcId = String(item.id || item.testCaseId || '');
      const dKey = tcKey ? `key_${tcKey}` : (tcId ? `id_${tcId}` : `item_${i}`);
      if (!seenTc.has(dKey)) {
        seenTc.add(dKey);
        const { _stub, ...rest } = item;
        rest.status = normalizeJiraStatus(rest.status);
        execution.push(rest);
      }
    }

    const rawAff = issue.fields?.versions || [];
    const rawFix = issue.fields?.fixVersions || [];
    const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const versionDisplay = affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión');

    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary || '',
      planId,
      schedule,
      environment: schedule?.environment || '',
      version: versionDisplay,
      versions: affectsVersions,
      fixVersions: fixVersions,
      rawFields: {
        created: issue.fields?.created || null,
        status: issue.fields?.status ? { name: issue.fields.status.name } : undefined,
        versions: affectsVersions,
        fixVersions: fixVersions
      },
      execution
    };
  });

  // Fetch live bug details in bulk via fast JQL, scoped to the current project
  const allBugKeys = new Set();
  cycles.forEach(c => {
    c.execution?.forEach(ex => {
      ex.linkedBugs?.forEach(b => {
        if (b && b.key) allBugKeys.add(b.key);
      });
    });
  });

  const inferredProjKey = (allIssues[0]?.key && allIssues[0].key.includes('-'))
    ? allIssues[0].key.split('-')[0].toUpperCase()
    : (projectId && isNaN(projectId) ? String(projectId).trim().toUpperCase() : null);

  const bugMap = await fetchBugsBatch(Array.from(allBugKeys), config, projectId, inferredProjKey);

  cycles.forEach(c => {
    let hadStaleBugs = false;
    if (Array.isArray(c.execution)) {
      c.execution.forEach(ex => {
        if (Array.isArray(ex.linkedBugs) && ex.linkedBugs.length > 0) {
          const prevLen = ex.linkedBugs.length;
          // Purge any dead, deleted, or moved-to-other-project bugs from Jira
          ex.linkedBugs = ex.linkedBugs
            .filter(b => b && b.key && bugMap[b.key])
            .map(b => {
              const { rawFields: _rf, ...leanBug } = bugMap[b.key];
              return { ...b, ...leanBug };
            });
          if (ex.linkedBugs.length !== prevLen) {
            hadStaleBugs = true;
          }
        }
      });
    }
    if (hadStaleBugs && c.id) {
      // Self-heal stored cycle index in background so moved/deleted bugs don't reappear
      const cleanedCompact = (c.execution || []).map(item => ({
        ...item,
        linkedBugs: trimBugsForIndex(item.linkedBugs || [])
      }));
      writeCycleIndex(c.id, cleanedCompact).catch(() => {});
    }
  });

  let plans = [];
  if (numOffset === 0) {
    try {
      const planType = config?.planIssueType || config?.testPlanIssueType;
      const projectJql = projectId ? `project = ${jqlQuote(projectId)} AND ` : '';
      const planCandidates = [
        planType,
        'Test Plan',
        'Test Set',
        'Plan de Pruebas',
        'Plan de pruebas',
        'Plan de Prueba',
        'Conjunto de Pruebas',
        'Plan'
      ];
      const planIssues = await fetchIssuesByCandidateTypes(
        projectId,
        projectJql,
        planCandidates,
        null,
        planType || 'Test Set',
        ['summary', 'status', 'created', 'issuetype'],
        null,
        ['testpulse-schedule', 'testpulse-v2']
      );
      plans = (planIssues || []).map(i => {
        const rawSchedProp = i.properties?.['testpulse-schedule'];
        const directSched = (rawSchedProp && typeof rawSchedProp === 'object')
          ? (rawSchedProp.value && typeof rawSchedProp.value === 'object' ? rawSchedProp.value : rawSchedProp)
          : null;
        const tpV2Prop = i.properties?.['testpulse-v2'];
        const tpV2Val = (tpV2Prop && typeof tpV2Prop === 'object')
          ? (tpV2Prop.value && typeof tpV2Prop.value === 'object' ? tpV2Prop.value : tpV2Prop)
          : null;
        const schedule = (directSched && (directSched.startDate || directSched.endDate || directSched.holidays))
          ? directSched
          : (tpV2Val?.schedule || directSched || null);
        return {
          id: i.id,
          key: i.key,
          summary: i.fields?.summary || '',
          status: i.fields?.status?.name || 'Active',
          created: i.fields?.created ? i.fields.created.split('T')[0] : '',
          schedule,
          rawFields: {
            created: i.fields?.created || null,
            status: i.fields?.status ? { name: i.fields.status.name } : undefined
          }
        };
      });
    } catch (e) {}
  }

  return {
    cycles,
    plans,
    bugMap,
    totalCycles: allIssues.length,
    hasMore,
    nextOffset,
    offset: numOffset,
    limit: numLimit,
    allCycleSummaries: allIssues.map(i => {
      const rawAff = i.fields?.versions || [];
      const rawFix = i.fields?.fixVersions || [];
      const affectsVersions = (Array.isArray(rawAff) ? rawAff : [rawAff]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const fixVersions = (Array.isArray(rawFix) ? rawFix : [rawFix]).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
      const versionDisplay = affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión');
      const { planId, schedule } = extractCyclePlanAndSchedule(i);
      return {
        id: i.id,
        key: i.key,
        summary: i.fields?.summary || '',
        planId,
        schedule,
        environment: schedule?.environment || '',
        version: versionDisplay,
        versions: affectsVersions,
        fixVersions: fixVersions,
        rawFields: {
          created: i.fields?.created || null,
          status: i.fields?.status ? { name: i.fields.status.name } : undefined,
          versions: affectsVersions,
          fixVersions: fixVersions
        }
      };
    })
  };
  });
});

resolver.define('getBugsBatch', async ({ payload }) => {
  const { keys = [], config = null } = payload || {};
  return await fetchBugsBatch(keys, config);
});

resolver.define('getCycleExecution', async ({ payload }) => {
  const { cycleId } = payload;
  return await getCycleExecutionSummary(cycleId);
});

resolver.define('getCycleExecutionSummary', async ({ payload }) => {
  const { cycleId } = payload;
  return await getCycleExecutionSummary(cycleId);
});

resolver.define('getTestExecution', async ({ payload }) => {
  const { cycleId, testId, testRunId } = payload;
  
  try {
    let targetRunId = testRunId;
    if (!targetRunId) {
      try {
        const items = (await readCycleIndex(cycleId)) || [];
        const matched = items.find(i => String(i.id) === String(testId) || i.key === String(testId) || (i.testCaseId && String(i.testCaseId) === String(testId)) || (i.testCaseKey && i.testCaseKey === String(testId)));
        if (matched && (matched.testRunId || matched.testRunKey)) {
          targetRunId = matched.testRunId || matched.testRunKey;
        }
      } catch (e) {}
    }
    if (!targetRunId) {
      const runIssues = await fetchAllIssues(
        `issue in linkedIssues(${jqlQuote(cycleId)})`,
        ['summary', 'status', 'assignee', 'attachment', 'description', 'issuelinks'],
        null,
        ['testpulse-run-data'],
        500
      );
      if (Array.isArray(runIssues)) {
        const found = runIssues.find(r => {
          const prop = r.properties?.['testpulse-run-data'] || {};
          return String(r.id) === String(testId) || 
                 r.key === String(testId) ||
                 String(prop.testCaseId) === String(testId) ||
                 prop.testCaseKey === String(testId) ||
                 r.fields?.summary?.includes(`[Run] ${testId}:`) ||
                 (r.fields?.issuelinks || []).some(l => {
                   const linked = l.outwardIssue || l.inwardIssue;
                   return linked && (String(linked.id) === String(testId) || linked.key === String(testId));
                 });
        });
        if (found) targetRunId = found.id;
      }
    }

    if (targetRunId) {
      const runRes = await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}?properties=testpulse-run-data&fields=summary,status,assignee,attachment,description,issuelinks`);
      if (runRes.ok) {
        const runIssue = await runRes.json();
        const prop = runIssue.properties?.['testpulse-run-data'] || {};
        
        const nativeStatusName = runIssue.fields?.status?.name || '';
        const normNativeStatus = normalizeJiraStatus(nativeStatusName);
        const runDataStatus = prop.status ? normalizeJiraStatus(prop.status) : null;
        
        let normStatus = 'Not Run';
        const hasTpExplicitExec = runDataStatus && runDataStatus !== 'Not Run' && (prop.executedBy || (prop.evidences && prop.evidences.length > 0) || (prop.iterations && prop.iterations.length > 0) || ['Passed', 'Failed', 'Blocked'].includes(runDataStatus));

        if (hasTpExplicitExec) {
          normStatus = runDataStatus;
        } else if (normNativeStatus && normNativeStatus !== 'Not Run') {
          normStatus = normNativeStatus;
        } else if (runDataStatus) {
          normStatus = runDataStatus;
        } else if (normNativeStatus) {
          normStatus = normNativeStatus;
        }

        return {
          id: testId,
          testRunId: runIssue.id,
          testRunKey: runIssue.key,
          testCaseId: prop.testCaseId || testId,
          testCaseKey: prop.testCaseKey || '',
          status: normStatus,
          nativeStatus: nativeStatusName || normStatus,
          comment: prop.comment || '',
          iterations: prop.iterations || [],
          evidences: filterNonIterationEvidences([
            ...(runIssue.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
            ...(prop.evidences || [])
          ], getIterationEvidenceKeys(prop.iterations)),
          executedBy: prop.executedBy || (runIssue.fields?.assignee ? { displayName: runIssue.fields.assignee.displayName, accountId: runIssue.fields.assignee.accountId } : null),
          executedAt: prop.executedAt,
          executionType: prop.executionType || 'Manual',
          description: runIssue.fields?.description || prop.snapshot?.testCaseDescription || null,
          linkedBugs: prop.linkedBugs || (runIssue.fields?.issuelinks || [])
            .filter(l => l.type?.name === 'Blocks' || l.outwardIssue?.fields?.issuetype?.name?.toLowerCase().includes('bug'))
            .map(l => ({ key: (l.outwardIssue || l.inwardIssue)?.key, summary: (l.outwardIssue || l.inwardIssue)?.fields?.summary })) || [],
          lockedAt: prop.lockedAt || null,
          _detailLoaded: true
        };
      }
    }
  } catch (err) {
    console.warn('[getTestExecution] Error looking up Test Run:', err.message);
  }

  return null;
});

resolver.define('addBulkTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases, config, projectId, cycleKey, skipIndexWrite } = payload;

  let lightWeightIndex = (await readCycleIndex(cycleId)) ?? [];
  // Only skip TCs that already have a tracked run in the lightweight index
  const existingIds = new Set(lightWeightIndex.filter(t => t.testRunId).map(t => String(t.id)));
  const newTests = (testCases || []).filter(tc => !existingIds.has(String(tc.id)));

  if (newTests.length > 0) {
    // createTestRunsInJiraForCycle with skipCandidateSearch avoids redundant JQL scans during bulk adds
    const CHUNK_SIZE = 25;
    const allCreatedRuns = [];
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
      const chunk = newTests.slice(i, i + CHUNK_SIZE);
      const created = await createTestRunsInJiraForCycle({
        projectId,
        cycleId,
        cycleKey,
        testCases: chunk,
        config,
        skipCandidateSearch: true
      });
      allCreatedRuns.push(...created);
    }

    if (!skipIndexWrite) {
      const updatedIndex = [...lightWeightIndex];
      allCreatedRuns.forEach(cr => {
        const idx = updatedIndex.findIndex(t => String(t.id) === String(cr.id));
        const entry = {
          id: String(cr.id),
          key: cr.testCaseKey || cr.key || '',
          testCaseKey: cr.testCaseKey || cr.key || '',
          testRunId: cr.testRunId,
          testRunKey: cr.testRunKey,
          summary: cr.summary || '',
          status: cr.status || 'Not Run',
          executionType: cr.executionType || 'Manual',
          linkedBugs: cr.linkedBugs || []
        };
        if (idx > -1) updatedIndex[idx] = entry;
        else updatedIndex.push(entry);
      });

      await writeCycleIndex(cycleId, updatedIndex);
    }

    await invalidateProjectReportCache(projectId || null);
    return { success: true, addedTests: allCreatedRuns };
  }

  return { success: true, addedTests: [] };
});

resolver.define('syncCycleIndexWithRuns', async ({ payload }) => {
  const { cycleId, addedRuns, projectId } = payload;
  if (!cycleId || !addedRuns || !Array.isArray(addedRuns) || addedRuns.length === 0) {
    return { success: true };
  }

  const existingIndex = (await readCycleIndex(cycleId)) ?? [];
  const updatedIndex = [...existingIndex];
  addedRuns.forEach(cr => {
    const idx = updatedIndex.findIndex(t => String(t.id) === String(cr.id) || (cr.testCaseKey && String(t.key) === String(cr.testCaseKey)));
    const entry = {
      id: String(cr.id || cr.testCaseId),
      key: cr.testCaseKey || cr.key || '',
      testCaseKey: cr.testCaseKey || cr.key || '',
      testRunId: cr.testRunId,
      testRunKey: cr.testRunKey,
      summary: cr.summary || '',
      status: cr.status || 'Not Run',
      executionType: cr.executionType || 'Manual',
      linkedBugs: cr.linkedBugs || []
    };
    if (idx > -1) updatedIndex[idx] = entry;
    else updatedIndex.push(entry);
  });

  await writeCycleIndex(cycleId, updatedIndex);
  await invalidateProjectReportCache(projectId || null);
  return { success: true };
});

resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase, config, projectId, cycleKey } = payload;
  
  const existingIndex = (await readCycleIndex(cycleId)) ?? [];
  const existing = existingIndex.find(t => String(t.id) === String(testCase.id));
  if (existing && existing.testRunId) {
    // Already tracked in index with a real Run ID — return as-is without any Jira query
    return { success: true, addedTest: { ...testCase, ...existing } };
  }

  // Delegate to createTestRunsInJiraForCycle which handles auto-recovery + creation in one query
  const createdRuns = await createTestRunsInJiraForCycle({
    projectId,
    cycleId,
    cycleKey,
    testCases: [testCase],
    config
  });

  const created = createdRuns[0] || {
    id: String(testCase.id),
    key: testCase.key,
    testCaseKey: testCase.key,
    summary: testCase.summary,
    status: 'Not Run',
    executionType: 'Manual'
  };

  await updateLightweightIndex(cycleId, (lw) => {
    const idx = lw.findIndex(t => String(t.id) === String(testCase.id));
    const entry = {
      id: String(testCase.id),
      key: created.testCaseKey || created.key || testCase.key || '',
      testCaseKey: created.testCaseKey || testCase.key || '',
      testRunId: created.testRunId,
      testRunKey: created.testRunKey,
      summary: created.summary || testCase.summary || '',
      status: created.status || 'Not Run',
      executionType: created.executionType || 'Manual',
      linkedBugs: created.linkedBugs || []
    };
    if (idx >= 0) {
      lw[idx] = { ...lw[idx], ...entry };
    } else {
      lw.push(entry);
    }
    return lw;
  });

  await invalidateProjectReportCache(projectId || null);
  return { success: true, addedTest: created };
});

resolver.define('addMultipleTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases, config, projectId, cycleKey } = payload;
  const createdRuns = await createTestRunsInJiraForCycle({
    projectId,
    cycleId,
    cycleKey,
    testCases,
    config
  });

  await updateLightweightIndex(cycleId, (lw) => {
    createdRuns.forEach(cr => {
      const idx = lw.findIndex(t => String(t.id) === String(cr.id));
      const entry = {
        id: String(cr.id),
        key: cr.testCaseKey || cr.key || '',
        testCaseKey: cr.testCaseKey || cr.key || '',
        testRunId: cr.testRunId,
        testRunKey: cr.testRunKey,
        summary: cr.summary || '',
        status: cr.status || 'Not Run',
        executionType: cr.executionType || 'Manual',
        linkedBugs: cr.linkedBugs || []
      };
      if (idx >= 0) {
        lw[idx] = { ...lw[idx], ...entry };
      } else {
        lw.push(entry);
      }
    });
    return lw;
  });

  await invalidateProjectReportCache(projectId || null);
  return { success: true, addedTests: createdRuns };
});

async function performRemoveTestsFromCycle(cycleId, testIds) {
  if (!testIds || testIds.length === 0) return { success: true, removed: 0 };
  const ids = testIds.map(String).filter(Boolean);
  const idsSet = new Set(ids);

  // 1. Immediately update lightweight index on cycle (matching all potential ID / Key variations)
  await updateLightweightIndex(cycleId, (lw) => {
    return lw.filter(t => {
      const tId = String(t.id || '');
      const tKey = String(t.key || '');
      const tTcKey = String(t.testCaseKey || '');
      const tRunId = String(t.testRunId || '');
      const tRunKey = String(t.testRunKey || '');
      return !idsSet.has(tId) &&
             (!tKey || !idsSet.has(tKey)) &&
             (!tTcKey || !idsSet.has(tTcKey)) &&
             (!tRunId || !idsSet.has(tRunId)) &&
             (!tRunKey || !idsSet.has(tRunKey));
    });
  });

  // 2. Fetch all linked issues for this cycle (without restricting issuetype, to catch Task fallback runs)
  try {
    const jql = `issue in linkedIssues(${jqlQuote(cycleId)})`;
    const runIssues = await fetchAllIssues(
      jql,
      ['id', 'key', 'status', 'attachment', 'issuelinks', 'summary'],
      null,
      ['testpulse-run-data'],
      50
    );

    // Identify which Test Runs in Jira belong to any of the deleted testIds
    const matchingRuns = (runIssues || []).filter(r => {
      // Don't match the cycle itself
      if (String(r.id) === String(cycleId) || String(r.key) === String(cycleId)) return false;

      const prop = r.properties?.['testpulse-run-data'] || {};
      const tcId = prop.testCaseId ? String(prop.testCaseId) : '';
      const tcKey = prop.testCaseKey ? String(prop.testCaseKey) : '';
      if (tcId && idsSet.has(tcId)) return true;
      if (tcKey && idsSet.has(tcKey)) return true;
      if (idsSet.has(String(r.id)) || idsSet.has(String(r.key))) return true;

      const links = r.fields?.issuelinks || [];
      for (const l of links) {
        const linked = l.outwardIssue || l.inwardIssue;
        if (linked && (idsSet.has(String(linked.id)) || idsSet.has(String(linked.key)))) {
          return true;
        }
      }

      if (r.fields?.summary) {
        const match = r.fields.summary.match(/\[Run\]\s*([A-Z0-9_-]+):/i);
        if (match && match[1] && idsSet.has(match[1])) return true;
        for (const k of idsSet) {
          if (k && k.includes('-') && r.fields.summary.includes(k)) return true;
        }
      }
      return false;
    });

    // Process matching runs according to Option C (Hybrid):
    // - Unexecuted / pristine runs -> Hard DELETE from Jira to keep project clean
    // - Executed runs with evidences/comments -> Unlink from cycle & preserve for auto-recovery
    await processInBatches(matchingRuns, 10, 50, async (r) => {
      try {
        const prop = r.properties?.['testpulse-run-data'] || {};
        const normStatus = normalizeJiraStatus(r.fields?.status?.name || prop.status || 'Not Run');
        const isExecuted = normStatus !== 'Not Run' && normStatus !== 'To Do';
        const hasEvidences = (r.fields?.attachment && r.fields.attachment.length > 0) || (prop.evidences && prop.evidences.length > 0);
        const hasCommentsOrIterations = (prop.comment && prop.comment.trim().length > 0) || (prop.iterations && prop.iterations.length > 0) || Boolean(prop.executedBy) || Boolean(prop.executedAt);
        const hasLinkedBugs = prop.linkedBugs && prop.linkedBugs.length > 0;

        if (isExecuted || hasEvidences || hasCommentsOrIterations || hasLinkedBugs) {
          // Preserve historical execution in Jira: Unlink from cycle and mark for recovery
          await unlinkIssueFromCycle(r.id, cycleId);
          await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}/properties/testpulse-run-data`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...prop,
              cycleId: String(cycleId),
              unlinkedFromCycle: true,
              unlinkedAt: Date.now()
            })
          }).catch(() => {});
        } else {
          // Pristine / unexecuted: Delete issue from Jira to prevent clutter
          const delRes = await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}`, { method: 'DELETE' }).catch(() => null);
          if (!delRes || !delRes.ok) {
            // Permission fallback: If user lacks Jira 'Delete Issues' permission, safely unlink
            await unlinkIssueFromCycle(r.id, cycleId);
            await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}/properties/testpulse-run-data`, {
              method: 'PUT',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...prop,
                cycleId: String(cycleId),
                unlinkedFromCycle: true,
                unlinkedAt: Date.now()
              })
            }).catch(() => {});
          }
        }
      } catch (e) {}
    });

    // Clean execution properties in parallel
    await processInBatches(ids, 15, 30, async (testId) => {
      await api.asUser().requestJira(
        route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`,
        { method: 'DELETE' }
      ).catch(() => {});
    });
  } catch (err) {
    console.warn('[performRemoveTestsFromCycle] Error during cleanup:', err);
  }

  await invalidateProjectReportCache();
  return { success: true, removed: ids.length };
}

resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId, testIds } = payload;
  const targetIds = testIds || (testId ? (Array.isArray(testId) ? testId : [testId]) : []);
  return await performRemoveTestsFromCycle(cycleId, targetIds);
});

resolver.define('removeManyTestsFromCycle', async ({ payload }) => {
  const { cycleId, testIds, testId } = payload;
  const targetIds = testIds || (testId ? (Array.isArray(testId) ? testId : [testId]) : []);
  return await performRemoveTestsFromCycle(cycleId, targetIds);
});



resolver.define('updateTestStatus', async ({ payload, context }) => {
  const { cycleId, testId, testRunId, status, comment, evidence, evidences, linkedBugs, steps, iterations, projectId, takeover } = payload;

  // Resolve target Test Run issue (native V2) and parallelize initial reads
  let targetRunId = testRunId;
  let userData = null;
  let isAdmin = false;
  let prefetchedRunRes = null;

  if (targetRunId) {
    // Fast Path (99% of V2 executions): Fetch cached user profile, cached admin permission,
    // and target Test Run (including `labels`) in a single parallel roundtrip.
    [userData, isAdmin, prefetchedRunRes] = await Promise.all([
      getCachedMyself(context),
      getCachedIsProjectAdmin(projectId, context),
      api.asUser().requestJira(
        route`/rest/api/3/issue/${targetRunId}?properties=testpulse-run-data&fields=summary,status,assignee,attachment,description,issuelinks,labels`
      ).catch(() => null)
    ]);
  } else {
    [userData, isAdmin] = await Promise.all([
      getCachedMyself(context),
      getCachedIsProjectAdmin(projectId, context)
    ]);
    try {
      const cycleRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}?properties=testpulse-cycle-index`);
      if (cycleRes.ok) {
        const cData = await cycleRes.json();
        const items = cData.properties?.['testpulse-cycle-index'] || [];
        const matched = items.find(i => String(i.id) === String(testId) || i.key === String(testId) || (i.testCaseId && String(i.testCaseId) === String(testId)) || (i.testCaseKey && i.testCaseKey === String(testId)));
        if (matched && matched.testRunId) {
          targetRunId = matched.testRunId;
        }
      }
    } catch (e) {}
    if (!targetRunId) {
      try {
        const runIssues = await fetchAllIssues(
          `issue in linkedIssues(${jqlQuote(cycleId)})`,
          ['summary', 'status', 'description', 'assignee', 'issuelinks'],
          null,
          ['testpulse-run-data'],
          500
        );
        if (Array.isArray(runIssues)) {
          const found = runIssues.find(r => {
            const prop = r.properties?.['testpulse-run-data'] || {};
            return String(r.id) === String(testId) || 
                   r.key === String(testId) ||
                   String(prop.testCaseId) === String(testId) ||
                   prop.testCaseKey === String(testId) ||
                   r.fields?.summary?.includes(`[Run] ${testId}:`) ||
                   (r.fields?.issuelinks || []).some(l => {
                     const linked = l.outwardIssue || l.inwardIssue;
                     return linked && (String(linked.id) === String(testId) || linked.key === String(testId));
                   });
          });
          if (found) targetRunId = found.id;
        }
      } catch (e) {
        console.warn('[updateTestStatus] Error finding Test Run:', e.message);
      }
    }
  }

  let executorInfo = undefined;
  if ((status && status !== 'Not Run' && status !== 'To Do' && userData) || (takeover && userData)) {
    executorInfo = {
      accountId: userData.accountId,
      displayName: userData.displayName
    };
  }

  const TERMINAL = ['Pass', 'Passed', 'Fail', 'Failed', 'Blocked'];
  let updatedTest = null;

  if (targetRunId) {
    // Use prefetched Test Run response or fetch it now (including `labels`)
    const runRes = prefetchedRunRes || await api.asUser().requestJira(
      route`/rest/api/3/issue/${targetRunId}?properties=testpulse-run-data&fields=summary,status,assignee,attachment,description,issuelinks,labels`
    );
    let runIssue = null;
    let currentProp = {};
    if (runRes && runRes.ok) {
      runIssue = await runRes.json();
      currentProp = runIssue.properties?.['testpulse-run-data'] || {};
    }

    const currentExecutedBy = currentProp.executedBy || (runIssue?.fields?.assignee ? { accountId: runIssue.fields.assignee.accountId, displayName: runIssue.fields.assignee.displayName } : null);
    if (!takeover && iterations === undefined && currentExecutedBy && userData && currentExecutedBy.accountId !== userData.accountId && !isAdmin) {
      throw new Error('Solo el usuario que ejecutó la prueba original o un administrador puede modificarla.');
    }

    const newStatus = status !== undefined ? status : (currentProp.status || normalizeJiraStatus(runIssue?.fields?.status?.name) || 'Not Run');
    const newComment = comment !== undefined ? comment : (currentProp.comment || '');
    
    const jiraAttachments = (runIssue?.fields?.attachment || []).map(a => ({
      id: String(a.id),
      filename: a.filename,
      url: a.content
    }));

    const newIterations = iterations !== undefined ? iterations : (currentProp.iterations || []);
    const iterKeys = getIterationEvidenceKeys(newIterations);

    let newEvidences;
    if (evidences !== undefined) {
      newEvidences = filterNonIterationEvidences(evidences, iterKeys);
    } else {
      newEvidences = filterNonIterationEvidences([...(currentProp.evidences || []), ...jiraAttachments], iterKeys);
    }
    if (evidence) {
      newEvidences = filterNonIterationEvidences([...newEvidences, evidence], iterKeys);
    }
    const newLinkedBugs = linkedBugs !== undefined ? linkedBugs : (currentProp.linkedBugs || []);
    const newExecutedBy = executorInfo !== undefined ? executorInfo : (currentExecutedBy || (userData ? { accountId: userData.accountId, displayName: userData.displayName } : null));
    const newLockedAt = TERMINAL.includes(newStatus) ? (currentProp.lockedAt || Date.now()) : (newStatus === 'Not Run' ? null : currentProp.lockedAt);

    updatedTest = {
      id: String(testId),
      testRunId: targetRunId,
      status: newStatus,
      comment: newComment,
      evidences: newEvidences,
      iterations: newIterations,
      linkedBugs: newLinkedBugs,
      executedBy: newExecutedBy,
      executedAt: Date.now(),
      lockedAt: newLockedAt
    };

    // 1. Save testpulse-run-data property FIRST on the Test Run issue itself
    // so any concurrent getTestExecution / getCycleExecutionSummary immediately reads the latest iterations.
    const newProp = {
      ...currentProp,
      status: newStatus,
      comment: newComment,
      iterations: newIterations,
      executedBy: newExecutedBy,
      executedAt: Date.now(),
      evidences: newEvidences,
      linkedBugs: newLinkedBugs,
      lockedAt: newLockedAt,
      _v2Clean: true
    };
    await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}/properties/testpulse-run-data`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newProp)
    }).catch(console.warn);

    // 2. Execute all secondary Jira synchronization tasks in parallel (Promise.allSettled)
    // and skip no-op mutations (assignee already matches, labels already match, legacy property already cleaned).
    const secondaryTasks = [];

    // 2a. Transition status in Jira
    if (status !== undefined) {
      secondaryTasks.push(transitionJiraIssue(targetRunId, newStatus).catch(console.warn));
    }

    // 2b. Assignee (Tester) — skip PUT if assignee already matches newExecutedBy.accountId
    const currentAssigneeId = runIssue?.fields?.assignee?.accountId || null;
    if (newExecutedBy?.accountId && currentAssigneeId !== newExecutedBy.accountId) {
      secondaryTasks.push(
        api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}/assignee`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: newExecutedBy.accountId })
        }).catch(console.warn)
      );
    }

    // 2c. Execution comment in Jira
    if (newStatus !== 'Not Run' || newComment || (newIterations && newIterations.length > 0)) {
      const commentAdf = buildExecutionAdfComment({
        cycleKey: cycleId,
        testCaseKey: testId,
        status: newStatus,
        comment: newComment,
        iterations: newIterations,
        executedBy: newExecutedBy
      });
      secondaryTasks.push(syncExecutionComment(targetRunId, commentAdf).catch(console.warn));
    }

    // 2d. Update status labels in Jira (using labels already loaded on runIssue; skip PUT if unchanged)
    const existingLabels = Array.isArray(runIssue?.fields?.labels) ? runIssue.fields.labels : [];
    const statusSlug = (newStatus || 'not-run').toLowerCase().replace(/\s+/g, '-');
    const cleanLabels = existingLabels.filter(l =>
      !l.startsWith('testpulse-status-') &&
      !l.startsWith('testpulse-passed') &&
      !l.startsWith('testpulse-failed') &&
      !l.startsWith('testpulse-blocked') &&
      !l.startsWith('testpulse-in-progress') &&
      !l.startsWith('testpulse-not-run') &&
      !l.startsWith('testpulse-pass') &&
      !l.startsWith('testpulse-fail')
    );
    const newLabels = [...cleanLabels, `testpulse-${statusSlug}`];
    const labelsUnchanged =
      existingLabels.length === newLabels.length &&
      existingLabels.every((lbl, idx) => lbl === newLabels[idx]);
    if (!labelsUnchanged) {
      secondaryTasks.push(
        api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { labels: newLabels } })
        }).catch(console.warn)
      );
    }

    // 2e. Update lightweight index on Cycle
    secondaryTasks.push(
      updateLightweightIndex(cycleId, (lw) => {
        const item = lw.find(l => String(l.id) === String(testId) || String(l.testRunId) === String(targetRunId));
        if (item) {
          item.status = newStatus;
          item.linkedBugs = trimBugsForIndex(newLinkedBugs);
          item.executedBy = newExecutedBy;
          if (newLockedAt) item.lockedAt = newLockedAt;
        }
        return lw;
      })
    );

    // 2f. Delete residual legacy exec_ property on the cycle issue only once per V2 Test Run
    if (!currentProp._v2Clean) {
      secondaryTasks.push(
        api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`, {
          method: 'DELETE'
        }).catch(() => {})
      );
    }

    await Promise.allSettled(secondaryTasks);

  } else {
    // No targetRunId found — attempt to create a Test Run now so future calls work
    const newStatus = status !== undefined ? status : 'Not Run';
    const newLockedAt = ['Pass', 'Passed', 'Fail', 'Failed', 'Blocked'].includes(newStatus) ? Date.now() : null;

    let createdRunId = null;
    let createdRunKey = null;
    try {
      // Try to create a Test Run and use it
      const cycleRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}?fields=summary,project`);
      if (cycleRes.ok) {
        const cycleIssue = await cycleRes.json();
        const projectKey = cycleIssue.fields?.project?.key;
        const projectIdFromCycle = cycleIssue.fields?.project?.id;
        const tcSnap = await getTestCaseSnapshot(testId);
        const tcSummary = tcSnap?.summary || String(testId);
        const tcKeyForRun = tcSnap?.key || String(testId);
        const runPayload = {
          fields: {
            summary: `[Run] ${tcKeyForRun}: ${tcSummary}`.substring(0, 255),
            project: { key: projectKey || cycleIssue.fields?.project?.key },
            issuetype: { name: 'Test Run' },
            description: ensureValidAdf(tcSnap?.description, `Snapshot del caso ${tcKeyForRun}: ${tcSummary}`)
          }
        };
        let createRes = await api.asUser().requestJira(route`/rest/api/3/issue`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(runPayload)
        });
        if (!createRes.ok) {
          runPayload.fields.issuetype = { name: 'Task' };
          createRes = await api.asUser().requestJira(route`/rest/api/3/issue`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(runPayload)
          });
        }
        if (createRes.ok) {
          const newRun = await createRes.json();
          createdRunId = newRun.id;
          createdRunKey = newRun.key;
          // Link to cycle & test case
          const linkPromises = [
            linkTwoIssues(createdRunId, cycleId, 'Relates')
          ];
          if (testId) {
            linkPromises.push(linkTwoIssues(createdRunId, testId, 'Relates'));
          }
          await Promise.all(linkPromises);
          const fallbackIterKeys = getIterationEvidenceKeys(iterations || []);
          const cleanFallbackEvidences = filterNonIterationEvidences(evidences || [], fallbackIterKeys);
          // Save run data
          const runDataProp = {
            cycleId: String(cycleId),
            testCaseId: String(testId),
            testCaseKey: tcSnap?.key || '',
            status: newStatus,
            comment: comment || '',
            iterations: iterations || [],
            evidences: cleanFallbackEvidences,
            linkedBugs: linkedBugs || [],
            executedBy: executorInfo || null,
            executedAt: Date.now(),
            lockedAt: newLockedAt,
            snapshot: {
              testCaseId: String(testId),
              testCaseKey: tcSnap?.key || '',
              testCaseSummary: tcSummary,
              testCaseDescription: tcSnap?.renderedDescription || null,
              includedSections: (tcSnap?.includedSections || []).map(s => s.section),
              executionType: tcSnap?.executionType || 'Manual',
              capturedAt: Date.now()
            }
          };
          await api.asUser().requestJira(route`/rest/api/3/issue/${createdRunId}/properties/testpulse-run-data`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(runDataProp)
          }).catch(() => {});
        }
      }
    } catch (createErr) {
      console.warn('[updateTestStatus] Could not create fallback Test Run:', createErr.message);
    }

    const fallbackIterKeys = getIterationEvidenceKeys(iterations || []);
    const cleanFallbackEvidences = filterNonIterationEvidences(evidences || [], fallbackIterKeys);
    updatedTest = {
      id: String(testId),
      testRunId: createdRunId,
      testRunKey: createdRunKey,
      status: newStatus,
      comment: comment || '',
      evidences: cleanFallbackEvidences,
      iterations: iterations || [],
      linkedBugs: linkedBugs || [],
      executedBy: executorInfo || null,
      lockedAt: newLockedAt
    };

    await updateLightweightIndex(cycleId, (lw) => {
      const item = lw.find(l => String(l.id) === String(testId));
      if (item) {
        item.status = newStatus;
        if (createdRunId) item.testRunId = createdRunId;
        if (createdRunKey) item.testRunKey = createdRunKey;
        item.linkedBugs = trimBugsForIndex(linkedBugs);
        item.executedBy = executorInfo;
        if (newLockedAt) item.lockedAt = newLockedAt;
      }
      return lw;
    });
  }

  await invalidateProjectReportCache(projectId || null);
  return { success: true, lockedAt: updatedTest?.lockedAt || null, test: updatedTest };
});


resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId } = payload;
  return await getCycleExecutionSummary(cycleId);
});

// Creates a Jira Issue Link between the test case and a bug
resolver.define('linkBugToTest', async ({ payload }) => {
  const { testCaseId, bugKey, bugId } = payload;
  const keyToCheck = (bugKey || bugId || '').toString().trim();
  
  if (!keyToCheck) {
    return { success: false, error: 'Clave o ID de incidencia no proporcionado.' };
  }

  try {
    // 1. Verify that the bug actually exists in Jira
    const fieldsToFetch = getBugJqlFields(payload?.config).join(',');
    const checkResp = await api.asUser().requestJira(route`/rest/api/3/issue/${keyToCheck}?fields=${fieldsToFetch}`);
    
    if (checkResp.status === 404 || !checkResp.ok) {
      return { 
        success: false, 
        notFound: true, 
        error: `La incidencia "${keyToCheck}" no existe en Jira o no tienes permisos para verla.` 
      };
    }
    const issueData = await checkResp.json();

    // 2. Determine inward and outward issues
    const outwardIssue = issueData.key ? { key: issueData.key } : (bugKey ? { key: bugKey } : { id: String(bugId) });
    const inwardIssue = (isNaN(Number(testCaseId)) && typeof testCaseId === 'string' && testCaseId.includes('-'))
      ? { key: testCaseId }
      : { id: String(testCaseId) };

    // 3. Try to establish Jira Issue Link with available link types
    let linkOk = false;
    let linkErrMsg = '';
    const candidateTypes = ['Blocks', 'Relates', 'Problem/Incident', 'Duplicate'];
    
    for (const typeName of candidateTypes) {
      try {
        const response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: { name: typeName },
            inwardIssue,
            outwardIssue
          })
        });
        if (response.status === 201 || response.status === 200) {
          linkOk = true;
          break;
        } else {
          linkErrMsg = summarizeJiraError(await response.text());
        }
      } catch (err) {
        linkErrMsg = err.message;
      }
    }

    if (!linkOk) {
      console.warn(`[linkBugToTest] IssueLink warning for ${keyToCheck}:`, linkErrMsg);
    }

    // Extract severity and versions dynamically
    const sevVal = extractBugSeverityFromFields(issueData.fields, payload?.config);

    const affectsVersions = (issueData.fields?.versions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const fixVersions = (issueData.fields?.fixVersions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const versionDisplay = affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión');

    await invalidateProjectReportCache();

    return { 
      success: true,
      linkOk,
      bug: {
        key: issueData.key,
        summary: issueData.fields?.summary || '',
        status: issueData.fields?.status?.name || 'Abierto',
        assignee: issueData.fields?.assignee?.displayName || 'Sin asignar',
        resolution: issueData.fields?.resolution?.name || 'Unresolved',
        priority: issueData.fields?.priority?.name || '',
        issuetype: issueData.fields?.issuetype?.name || 'Bug',
        severity: sevVal,
        created: issueData.fields?.created || null,
        resolutiondate: issueData.fields?.resolutiondate || null,
        versions: affectsVersions,
        fixVersions: fixVersions,
        version: versionDisplay,
        rawFields: issueData.fields
      }
    };
  } catch (e) {
    console.error('linkBugToTest error:', e);
    return { success: false, error: e.message };
  }
});


resolver.define('bulkCreateTestCases', async ({ payload }) => {
  const issues = payload.issues || [];
  const MAX_BATCH = 1000;
  const results = [];

  for (let i = 0; i < issues.length; i += MAX_BATCH) {
    const batch = issues.slice(i, i + MAX_BATCH);
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/bulk`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueUpdates: batch })
      }
    );
    const data = await response.json();
    if (data.issues) {
      results.push(...data.issues.map(item => ({ key: item.key, id: item.id, success: true })));
    }
    if (data.errors) {
      results.push(...data.errors.map(err => ({ ...err, success: false })));
    }
  }
  return { results };
});

// === Bug Resolution Time, Details, Slide-Out Panel & Editing ===
registerBugResolvers(resolver);


resolver.define('getTestCaseHistory', async ({ payload }) => {
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 18000; // stay well below Forge's 25s resolver limit
  try {
    const { testId, projectId, config } = payload || {};
    if (!testId) return [];

    let tcId = String(testId);
    let tcKey = '';
    let targetProjectId = projectId;

    try {
      const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testId}?fields=summary,project`);
      if (tcRes.ok) {
        const tcData = await tcRes.json();
        tcId = String(tcData.id);
        tcKey = tcData.key;
        if (!targetProjectId) targetProjectId = tcData.fields?.project?.id;
      } else {
        console.warn(`[getTestCaseHistory] TC ${testId} fetch failed: ${tcRes.status}`);
      }
    } catch (e) {
      console.warn('[getTestCaseHistory] Could not fetch tc issue:', e.message);
    }

    const historyMap = new Map(); // cycleId|runKey -> item
    const runTypeName = (config?.testRunType || 'Test Run').toLowerCase();

    const toItem = (run, prop, cycle) => {
      const tpStatus = prop.status ? normalizeJiraStatus(prop.status) : null;
      const nativeStatus = normalizeJiraStatus(run.fields?.status?.name || 'Not Run');
      const status = (tpStatus && tpStatus !== 'Not Run') ? tpStatus : (nativeStatus || tpStatus || 'Not Run');
      return {
        cycleId: cycle.id || run.id,
        cycleKey: cycle.key || run.key,
        cycleSummary: cycle.summary || '',
        testRunKey: run.key,
        testRunId: run.id,
        status,
        executedBy: prop.executedBy || (run.fields?.assignee ? { displayName: run.fields.assignee.displayName, accountId: run.fields.assignee.accountId } : null),
        iterations: prop.iterations || [],
        comment: prop.comment || '',
        executedAt: prop.executedAt || run.fields?.created
      };
    };

    // 1. Test Runs linked to this Test Case (runs are always linked to their TC on creation)
    try {
      const ref = tcKey || tcId;
      const jql = `issue in linkedIssues(${jqlQuote(ref)}) ORDER BY created DESC`;
      const runs = await fetchAllIssues(jql, ['summary', 'status', 'assignee', 'issuelinks', 'created', 'issuetype'], null, ['testpulse-run-data'], 4);
      for (const run of runs) {
        const prop = run.properties?.['testpulse-run-data'] || {};
        const typeName = (run.fields?.issuetype?.name || '').toLowerCase();
        const looksLikeRun = !!(prop.testCaseId || prop.testCaseKey) ||
          (run.fields?.summary || '').startsWith('[Run]') ||
          typeName === runTypeName || typeName.includes('run') || typeName.includes('ejecuci');
        if (!looksLikeRun) continue;

        const belongs = (!prop.testCaseId && !prop.testCaseKey) ||
          String(prop.testCaseId) === tcId || (tcKey && prop.testCaseKey === tcKey);
        if (!belongs) continue;

        const links = (run.fields?.issuelinks || []).map(l => l.outwardIssue || l.inwardIssue).filter(Boolean);
        const linkedCycle = links.find(i => String(i.id) === String(prop.cycleId)) ||
          links.find(i => String(i.id) !== tcId && (!tcKey || i.key !== tcKey));
        const cycle = {
          id: prop.cycleId ? String(prop.cycleId) : (linkedCycle ? String(linkedCycle.id) : ''),
          key: prop.cycleKey || linkedCycle?.key || '',
          summary: linkedCycle?.fields?.summary || ''
        };
        historyMap.set(cycle.id || run.key, toItem(run, prop, cycle));
      }
    } catch (errSearch) {
      console.warn('[getTestCaseHistory] Linked runs search error:', errSearch.message);
    }

    // 2. Fallback: cycle indexes (covers legacy runs without links). Bounded + time-budgeted.
    try {
      if (targetProjectId && Date.now() - startedAt < TIME_BUDGET_MS) {
        const cycleType = config?.testCycleType || 'Test Cycle';
        const cycleJql = `project = ${jqlQuote(targetProjectId)} AND issuetype = ${jqlQuote(cycleType)} ORDER BY created DESC`;
        const page = await fetchJqlPage(cycleJql, ['summary'], null, null, null, 100);
        if (page.error) console.warn('[getTestCaseHistory] Cycle search error:', page.error);
        const cycles = page.issues || [];

        // Fill summaries for cycles already found
        for (const c of cycles) {
          const ex = historyMap.get(String(c.id));
          if (ex) { ex.cycleSummary = ex.cycleSummary || c.fields?.summary || ''; ex.cycleKey = ex.cycleKey || c.key; }
        }

        const pending = cycles.filter(c => !historyMap.has(String(c.id)));
        await mapWithConcurrency(pending, 3, async (c) => {
          if (Date.now() - startedAt > TIME_BUDGET_MS) return;
          const entries = (await readCycleIndex(c.id)) || [];
          const match = entries.find(e => String(e.id) === tcId || String(e.testCaseId || '') === tcId || (tcKey && (e.key === tcKey || e.testCaseKey === tcKey)));
          if (!match) return;
          historyMap.set(String(c.id), {
            cycleId: c.id,
            cycleKey: c.key,
            cycleSummary: c.fields?.summary || '',
            testRunKey: match.testRunKey || '',
            testRunId: match.testRunId || '',
            status: normalizeJiraStatus(match.status || 'Not Run'),
            executedBy: match.executedBy || null,
            iterations: match.iterations || [],
            comment: match.comment || '',
            executedAt: match.executedAt || null
          });
        });
      }
    } catch (errCycles) {
      console.warn('[getTestCaseHistory] Cycle scan error:', errCycles.message);
    }

    return Array.from(historyMap.values()).sort((a, b) => {
      const ta = a.executedAt ? new Date(a.executedAt).getTime() : 0;
      const tb = b.executedAt ? new Date(b.executedAt).getTime() : 0;
      return tb - ta;
    });
  } catch (e) {
    console.error("getTestCaseHistory error:", e);
    return [];
  }
});

resolver.define('getIssueDescription', async ({ payload }) => {
  try {
    const { issueId } = payload;
    if (!issueId) return null;

    const fieldMap = await resolveSnapshotFieldIds();
    const extraIds = [...fieldMap.precondition, ...fieldMap.steps, ...fieldMap.expected].map(f => f.id);
    const fieldList = ['description', 'summary', 'issuelinks', ...extraIds].join(',');

    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=${fieldList}&properties=testpulse-run-data&expand=renderedFields`);
    if (!response.ok) return null;
    const data = await response.json();

    const withSections = (issueData) => {
      const base = issueData.renderedFields?.description || '';
      const sections = buildSnapshotSections(fieldMap, issueData.fields, issueData.renderedFields);
      const html = base + sections.html;
      return html || issueData.fields?.description || null;
    };

    let desc = withSections(data);
    const runProp = data.properties?.['testpulse-run-data'] || {};

    // If description is empty or generic run text, check snapshot or parent Test Case
    if (!desc || (typeof desc === 'string' && desc.includes('Test Run execution for test case'))) {
      if (runProp.snapshot?.testCaseDescription) {
        return runProp.snapshot.testCaseDescription;
      }
      let parentTcKeyOrId = runProp.testCaseId || runProp.testCaseKey;
      if (!parentTcKeyOrId && data.fields?.summary) {
        const match = data.fields.summary.match(/\[Run\]\s*([A-Z0-9_-]+):/i);
        if (match && match[1]) parentTcKeyOrId = match[1];
      }
      if (parentTcKeyOrId && String(parentTcKeyOrId) !== String(issueId)) {
        const tcFieldList = ['description', ...extraIds].join(',');
        const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${parentTcKeyOrId}?fields=${tcFieldList}&expand=renderedFields`);
        if (tcRes.ok) {
          const tcData = await tcRes.json();
          return withSections(tcData) || desc;
        }
      }
    }
    return desc;
  } catch (e) {
    console.error("Error fetching description:", e);
    return null;
  }
});

// Rebuilds the execution index directly from native Jira Test Run issues
resolver.define('rebuildCycleIndex', async ({ payload }) => {
  const { cycleId } = payload;
  const jql = `issue in linkedIssues(${jqlQuote(cycleId)})`;
  const runIssues = await fetchAllIssues(
    jql,
    ['summary', 'status', 'assignee', 'issuelinks'],
    null,
    ['testpulse-run-data'],
    50
  );

  const validRuns = (runIssues || []).filter(run => {
    const summary = run.fields?.summary || '';
    const prop = run.properties?.['testpulse-run-data'];
    const type = run.fields?.issuetype?.name || '';
    const isRunType = ['Test Run', 'TestRun', 'Ejecución de prueba', 'Ejecución', 'Test Execution'].some(t => type.toLowerCase().includes(t.toLowerCase()));
    const isTcType = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba', 'Test', 'Tarea', 'Task'].some(t => type.toLowerCase().includes(t.toLowerCase()));
    return prop || summary.startsWith('[Run]') || isRunType || isTcType;
  });

  const indexEntries = validRuns.map(run => {
    const runData = run.properties?.['testpulse-run-data'] || {};
    const type = run.fields?.issuetype?.name || '';
    const isDirectTc = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba'].some(t => type.toLowerCase().includes(t.toLowerCase()));

    let tcKey = runData.testCaseKey || (isDirectTc ? run.key : '');
    if (!tcKey) {
      tcKey = (run.fields?.issuelinks || [])
        .map(l => l.outwardIssue || l.inwardIssue)
        .filter(Boolean)
        .find(i => String(i.id) !== String(cycleId))?.key || '';
    }
    if (!tcKey && run.fields?.summary) {
      const match = run.fields.summary.match(/\[Run\]\s*([A-Z0-9_-]+):/i);
      if (match && match[1]) {
        tcKey = match[1];
      }
    }
    let tcId = runData.testCaseId || (isDirectTc ? String(run.id) : '');
    if (!tcId) {
      tcId = (run.fields?.issuelinks || [])
        .map(l => l.outwardIssue || l.inwardIssue)
        .filter(Boolean)
        .find(i => String(i.id) !== String(cycleId))?.id || (tcKey || run.id);
    }
    
    const nativeStatusName = run.fields?.status?.name || '';
    const normNativeStatus = normalizeJiraStatus(nativeStatusName);
    const runDataStatus = runData.status ? normalizeJiraStatus(runData.status) : null;
    let normStatus = 'Not Run';
    const hasTpExplicitExec = runDataStatus && runDataStatus !== 'Not Run' && (runData.executedBy || (runData.evidences && runData.evidences.length > 0) || (runData.iterations && runData.iterations.length > 0) || ['Passed', 'Failed', 'Blocked'].includes(runDataStatus));

    if (hasTpExplicitExec) {
      normStatus = runDataStatus;
    } else if (normNativeStatus && normNativeStatus !== 'Not Run') {
      normStatus = normNativeStatus;
    } else if (runDataStatus) {
      normStatus = runDataStatus;
    } else if (normNativeStatus) {
      normStatus = normNativeStatus;
    }

    return {
      id: String(tcId),
      key: tcKey || run.key,
      testRunId: run.id,
      testRunKey: run.key,
      testCaseId: String(tcId),
      testCaseKey: tcKey || run.key,
      status: normStatus,
      executionType: runData.executionType || 'Manual',
      assignee: run.fields?.assignee || null,
      executedBy: runData.executedBy || (run.fields?.assignee ? { displayName: run.fields.assignee.displayName, accountId: run.fields.assignee.accountId } : null),
      executedAt: runData.executedAt || null,
      linkedBugs: trimBugsForIndex(runData.linkedBugs || []),
      lockedAt: runData.lockedAt || null
    };
  });

  await writeCycleIndex(cycleId, indexEntries);

  return {
    success: true,
    rebuilt: indexEntries.length,
    total: indexEntries.length,
    done: true
  };
});


// Fast migration — converts legacy format IDs to stub objects WITHOUT reading exec_ properties.
// Stubs have _stub:true so getCycleExecutionSummary/updateLightweightIndex know to heal on next open.
// Time per cycle: ~1 PUT only → no timeout possible, handles 1000+ test cycles.
resolver.define('migrateAllCycles', async ({ payload }) => {
  const { projectId, config, offset = 0, limit = 1 } = payload;
  const cycleType = config?.testCycleType || 'Test Cycle';
  const jql = `project = ${jqlQuote(projectId)} AND issuetype = ${jqlQuote(cycleType)} ORDER BY created DESC`;

  // Fetch all cycle stubs — IDs + execution snapshot (no exec_ reads)
  let allIssues = [];
  let token = null;
  let isLast = false;
  while (!isLast) {
    const page = await fetchJqlPage(jql, ['summary'], null, ['execution'], token, 100);
    if (page.error) break;
    allIssues = allIssues.concat(page.issues);
    token = page.nextPageToken;
    isLast = page.isLast;
    if (!token) break;
  }

  const total = allIssues.length;
  const batch = allIssues.slice(offset, offset + limit);
  const results = { total, processed: offset, migrated: 0, alreadyModern: 0, skipped: 0, errors: [], done: false };

  for (const issue of batch) {
    results.processed++;
    try {
      const executionRaw = (issue.properties || {})['execution'] || [];

      if (!Array.isArray(executionRaw) || executionRaw.length === 0) {
        results.skipped++;
        continue;
      }

      if (typeof executionRaw[0] === 'object') {
        // Already modern format — skip only if no stubs present
        if (!executionRaw.some(ex => ex._stub === true)) {
          results.alreadyModern++;
          continue;
        }
        // Has stubs but no exec_ reads needed — already converted, skip
        results.alreadyModern++;
        continue;
      }

      // Legacy format (string IDs) — convert to stub objects (fast, no exec_ reads)
      const stubIndex = executionRaw.map(id => ({
        id: String(id),
        status: 'Not Run',
        linkedBugs: [],
        _stub: true   // signals getCycleExecutionSummary to heal on next open
      }));

      await writeCycleIndex(issue.id, stubIndex);
      results.migrated++;
    } catch (err) {
      results.errors.push(`${issue.key}: ${err.message}`);
    }
  }

  results.done = results.processed >= total;
  results.nextOffset = results.done ? null : offset + limit;
  return results;
});


// ── Todos los bugs del espacio/proyecto Jira en el que se trabaja ──
resolver.define('getProjectUnlinkedBugs', async ({ payload }) => {
  const { projectId, projectKey, linkedBugKeys = [], bugIssueTypes = [], config = null } = payload || {};

  const linkedSet = new Set(linkedBugKeys.map(String));

  // Determine target project identifier
  let targetProj = projectKey || projectId;
  let resolvedProjectKey = projectKey || null;

  // Build issue type filter
  const defaultBugKeywords = ['bug', 'defect', 'defecto', 'falla', 'error', 'incident', 'incidente', 'issue', 'problem', 'problema', 'fallo', 'anomalia', 'anomalía'];
  let typeIds = [];
  let allProjIssueTypes = [];

  try {
    if (targetProj) {
      const projRes = await api.asUser().requestJira(route`/rest/api/3/project/${targetProj}`);
      if (projRes.ok) {
        const projData = await projRes.json();
        if (projData.key) {
          resolvedProjectKey = projData.key;
        }
        allProjIssueTypes = projData.issueTypes || [];
        console.log(`[getProjectUnlinkedBugs] Target: ${targetProj} (Key: ${resolvedProjectKey}), issueTypes found in project:`, allProjIssueTypes.map(t => `${t.name} (ID: ${t.id})`).join(', '));
        
        typeIds = allProjIssueTypes
          .filter(t => {
            const nameLow = (t.name || '').toLowerCase().trim();
            const inConfig = bugIssueTypes.some(bt => (bt || '').toLowerCase().trim() === nameLow);
            const isDefaultBug = defaultBugKeywords.some(kw => nameLow.includes(kw));
            return inConfig || isDefaultBug;
          })
          .map(t => t.id);
      }
    }
  } catch(e) { console.warn("Failed to get project issue types for JQL", e); }
  
  const effectiveProject = resolvedProjectKey || targetProj || projectId;
  let projectJql = '';
  if (effectiveProject) {
    projectJql = `project = ${jqlQuote(effectiveProject)} AND `;
  }

  let typeClause = '';
  if (typeIds.length > 0) {
    typeClause = `issuetype in (${typeIds.join(',')})`;
  } else {
    // Fallback to all standard bug names if typeIds couldn't be resolved
    const fallbackTypes = ['Error', 'Bug', 'Defect', 'Defecto', 'Falla', 'Incident', 'Incidente', 'Problema', 'Problem'];
    typeClause = `issuetype in (${fallbackTypes.map(t => jqlQuote(t)).join(',')})`;
  }

  const jql = `${projectJql}${typeClause} ORDER BY created DESC`;
  console.log(`[getProjectUnlinkedBugs] Running JQL query: ${jql}`);
  const fields = getBugJqlFields(config, ['reporter', 'project', 'issuelinks']);

  let allIssues = [];
  let token = null;
  let isLast = false;
  let pages = 0;

  try {
    while (!isLast && pages < 10) {
      const page = await fetchJqlPage(jql, fields, 'changelog', null, token, 100);
      if (page.error) {
        console.warn(`[getProjectUnlinkedBugs] JQL search warning:`, page.error);
        break;
      }
      allIssues = allIssues.concat(page.issues || []);
      token = page.nextPageToken;
      isLast = page.isLast !== undefined ? page.isLast : (token == null);
      if (!token) break;
      pages++;
    }
  } catch (e) {
    console.error("Exception in getProjectUnlinkedBugs:", e);
  }

  console.log(`[getProjectUnlinkedBugs] Total bugs retrieved from Jira: ${allIssues.length}`);

  const upperProjKey = resolvedProjectKey ? String(resolvedProjectKey).trim().toUpperCase() : '';
  const targetProjIdStr = projectId ? String(projectId).trim() : '';

  // Strictly exclude any bug whose current key or project does not belong to the active project
  const projectIssues = allIssues.filter(issue => {
    const issueKeyUpper = String(issue?.key || '').trim().toUpperCase();
    if (!issueKeyUpper) return false;
    const issueProjKey = issue?.fields?.project?.key ? String(issue.fields.project.key).trim().toUpperCase() : '';
    const issueProjId = issue?.fields?.project?.id ? String(issue.fields.project.id).trim() : '';
    if (upperProjKey && !issueKeyUpper.startsWith(upperProjKey + '-')) return false;
    if (upperProjKey && issueProjKey && issueProjKey !== upperProjKey) return false;
    if (targetProjIdStr && issueProjId && issueProjKey && issueProjId !== targetProjIdStr && issueProjKey !== targetProjIdStr.toUpperCase()) return false;
    return true;
  });

  // Return ALL project bugs with explicit issuelinks detection
  return projectIssues.map(issue => {
    const sev = extractBugSeverityFromFields(issue.fields, config);
    const affectsVersions = (issue.fields?.versions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const fixVersions = (issue.fields?.fixVersions || []).map(v => typeof v === 'object' ? (v.name || v.value || String(v)) : String(v)).filter(Boolean);
    const versionDisplay = affectsVersions.length > 0 ? affectsVersions.join(', ') : (fixVersions.length > 0 ? fixVersions.join(', ') : 'Sin versión');
    const estResDate = extractBugEstimatedDateFromFields(issue.fields, config, true);
    const changelogMeta = analyzeBugChangelog(issue);

    // Inspect Jira issuelinks on the bug to see if it is linked to any test entity
    let isLinkedToTest = linkedSet.has(issue.key);
    const linkedTests = [];

    (issue.fields?.issuelinks || []).forEach(link => {
      const other = link.outwardIssue || link.inwardIssue;
      if (!other) return;
      const typeName = (other.fields?.issuetype?.name || '').toLowerCase();
      const summary = other.fields?.summary || '';
      const otherKey = other.key || '';
      
      const isTestEntity = typeName.includes('run') || 
                           typeName.includes('cycle') || 
                           typeName.includes('case') || 
                           typeName.includes('set') || 
                           typeName.includes('plan') || 
                           typeName.includes('prueba') || 
                           typeName.includes('caso') || 
                           typeName.includes('ejecución') ||
                           typeName.includes('ejecucion') ||
                           summary.startsWith('[Test') || 
                           summary.startsWith('TC-') || 
                           summary.startsWith('TR-');
      
      if (isTestEntity) {
        isLinkedToTest = true;
        linkedTests.push({
          id: other.id,
          key: otherKey,
          summary: summary,
          type: other.fields?.issuetype?.name || 'Test',
          status: other.fields?.status?.name || '',
          linkType: link.type?.name || 'Relates'
        });
      }
    });

    return {
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || '',
      statusCategory: issue.fields?.status?.statusCategory?.key || '',
      assignee: issue.fields?.assignee?.displayName || null,
      priority: issue.fields?.priority?.name || null,
      severity: sev,
      resolution: issue.fields?.resolution?.name || null,
      reporter: issue.fields?.reporter?.displayName || null,
      created: issue.fields?.created || null,
      resolutiondate: issue.fields?.resolutiondate || changelogMeta.lastTerminalAt || null,
      duedate: estResDate,
      estimatedResolutionDate: estResDate,
      versions: affectsVersions,
      fixVersions: fixVersions,
      version: versionDisplay,
      issuetype: issue.fields?.issuetype?.name || 'Bug',
      project: issue.fields?.project?.key || '',
      isLinked: isLinkedToTest,
      linkedTests: linkedTests,
      ...changelogMeta,
      rawFields: {
        created: issue.fields?.created || null,
        resolutiondate: issue.fields?.resolutiondate || changelogMeta.lastTerminalAt || null,
        duedate: estResDate,
        status: issue.fields?.status ? { name: issue.fields.status.name } : undefined,
        resolution: issue.fields?.resolution ? { name: issue.fields.resolution.name } : undefined,
        issuetype: issue.fields?.issuetype ? { name: issue.fields.issuetype.name } : undefined,
        versions: affectsVersions,
        fixVersions: fixVersions,
        customfield_10238: sev !== 'Sin definir' ? sev : undefined
      }
    };
  });
});




// ============================================================================
// === ARCHITECTURE V2: "Test Run" Jira Issues Engine ========================
// ============================================================================

// Helper: Transitions a Jira Issue to a target status name (e.g. Passed, Failed, Blocked, In Progress, Not Run)
async function transitionJiraIssue(issueIdOrKey, targetStatusName) {
  if (!issueIdOrKey || !targetStatusName) return { success: false, reason: 'Missing params' };
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`);
    if (!res.ok) {
      console.warn(`[transitionJiraIssue] Failed to get transitions for ${issueIdOrKey}: ${res.status}`);
      return { success: false, status: res.status };
    }
    const data = await res.json();
    const transitions = data.transitions || [];
    if (transitions.length === 0) {
      console.warn(`[transitionJiraIssue] No available transitions for ${issueIdOrKey}`);
      return { success: false, reason: 'No available transitions' };
    }

    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetNorm = norm(targetStatusName);

    // Group matching keywords by priority
    let directKeywords = [];
    let fallbackCategory = null; // 'done', 'indeterminate', 'new'
    let fallbackKeywords = [];

    if (['passed', 'pass', 'exitoso', 'aprobado'].includes(targetNorm)) {
      directKeywords = ['passed', 'pass', 'exitoso', 'aprobado', 'exito', 'superado', 'validado', 'ok'];
      fallbackKeywords = ['done', 'listo', 'finalizado', 'completado', 'cerrado', 'resolved', 'resuelto', 'terminado'];
      fallbackCategory = 'done';
    } else if (['failed', 'fail', 'fallido', 'rechazado'].includes(targetNorm)) {
      directKeywords = ['failed', 'fail', 'fallido', 'rechazado', 'error', 'noaprobado', 'defectuoso', 'bloqueado'];
      fallbackKeywords = ['done', 'listo', 'finalizado', 'cerrado', 'resuelto', 'terminado'];
      fallbackCategory = 'done';
    } else if (['blocked', 'bloqueado', 'impedido'].includes(targetNorm)) {
      directKeywords = ['blocked', 'bloqueado', 'impedido', 'detenido', 'espera', 'onhold', 'pausado', 'hold'];
      fallbackKeywords = ['in progress', 'en curso', 'en progreso', 'en desarrollo'];
      fallbackCategory = 'indeterminate';
    } else if (['inprogress', 'encurso', 'enprogreso'].includes(targetNorm)) {
      directKeywords = ['inprogress', 'encurso', 'enprogreso', 'endesarrollo', 'enejecucion', 'inexecution', 'inreview'];
      fallbackCategory = 'indeterminate';
    } else if (['notrun', 'todo', 'porhacer', 'sinejecutar'].includes(targetNorm)) {
      directKeywords = ['notrun', 'todo', 'porhacer', 'sinejecutar', 'abierto', 'open', 'backlog', 'reopen', 'reabrir', 'volver a abrir'];
      fallbackCategory = 'new';
    } else {
      directKeywords = [targetNorm];
    }

    // 1. Check direct keyword match on transition name or target status name
    let matched = transitions.find(t => {
      const nameNorm = norm(t.name);
      const toNameNorm = norm(t.to?.name);
      return directKeywords.some(kw => nameNorm.includes(kw) || toNameNorm.includes(kw));
    });

    // 2. Check fallback keywords match
    if (!matched && fallbackKeywords.length > 0) {
      matched = transitions.find(t => {
        const nameNorm = norm(t.name);
        const toNameNorm = norm(t.to?.name);
        return fallbackKeywords.some(kw => nameNorm.includes(kw) || toNameNorm.includes(kw));
      });
    }

    // 3. Check statusCategory match (e.g. key === 'done' or 'indeterminate' or 'new')
    if (!matched && fallbackCategory) {
      matched = transitions.find(t => {
        const catKey = (t.to?.statusCategory?.key || '').toLowerCase();
        return catKey === fallbackCategory;
      });
    }

    // 4. Multi-hop if no direct transition to 'done' from 'To Do' (transition to In Progress first if available)
    if (!matched && fallbackCategory === 'done') {
      const inProgTrans = transitions.find(t => {
        const catKey = (t.to?.statusCategory?.key || '').toLowerCase();
        const toNameNorm = norm(t.to?.name);
        return catKey === 'indeterminate' || toNameNorm.includes('curso') || toNameNorm.includes('progress');
      });
      if (inProgTrans) {
        // Step 1: transition to In Progress
        await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ transition: { id: inProgTrans.id } })
        });
        // Step 2: recursive call to transition to Done/Passed
        return await transitionJiraIssue(issueIdOrKey, targetStatusName);
      }
    }

    if (!matched) {
      console.log(`[transitionJiraIssue] No matching transition for "${targetStatusName}" on ${issueIdOrKey}. Available:`, transitions.map(t => `${t.id}: ${t.name} -> ${t.to?.name} (${t.to?.statusCategory?.key})`));
      return { success: false, reason: 'No transition match', available: transitions.map(t => t.name) };
    }

    const transRes = await api.asUser().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/transitions`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: matched.id } })
    });

    if (!transRes.ok) {
      const errText = summarizeJiraError(await transRes.text());
      console.warn(`[transitionJiraIssue] Transition failed for ${issueIdOrKey}: ${transRes.status} ${errText}`);
      return { success: false, error: errText };
    }

    return { success: true, transitionId: matched.id, toStatus: matched.to?.name };
  } catch (e) {
    console.error(`[transitionJiraIssue] Exception for ${issueIdOrKey}:`, e);
    return { success: false, error: e.message };
  }
}

// Helper: Creates an Issue Link between two Jira issues with retries and fallback types
async function linkTwoIssues(inwardIdOrKey, outwardIdOrKey, linkTypeName = 'Relates', maxRetries = 3) {
  if (!inwardIdOrKey || !outwardIdOrKey) return false;
  const inwardIssue = String(inwardIdOrKey).includes('-') ? { key: String(inwardIdOrKey) } : { id: String(inwardIdOrKey) };
  const outwardIssue = String(outwardIdOrKey).includes('-') ? { key: String(outwardIdOrKey) } : { id: String(outwardIdOrKey) };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: { name: linkTypeName },
          inwardIssue,
          outwardIssue
        })
      });

      if (res.ok || res.status === 201 || res.status === 200) {
        return true;
      }

      // If Jira returned 400 because the link type name isn't 'Relates', try Spanish/English alternates
      if (res.status === 400 && attempt === 0) {
        const altTypes = ['relates to', 'Relaciona', 'Reference', 'relacionado'];
        for (const alt of altTypes) {
          if (alt.toLowerCase() === linkTypeName.toLowerCase()) continue;
          const altRes = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: { name: alt },
              inwardIssue,
              outwardIssue
            })
          }).catch(() => null);
          if (altRes && (altRes.ok || altRes.status === 201 || altRes.status === 200)) {
            return true;
          }
        }
      }

      // If rate limited or locked (429, 409, 500, 503), wait with backoff
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt) + Math.random() * 100));
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[linkTwoIssues] Failed linking ${inwardIdOrKey} -> ${outwardIdOrKey} (${res.status}): ${errText}`);
      }
    } catch (e) {
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
      } else {
        console.warn(`[linkTwoIssues] Exception linking ${inwardIdOrKey} -> ${outwardIdOrKey}:`, e.message);
      }
    }
  }
  return false;
}

// Resolver: Creates Test Run Jira Issues in bulk for a cycle
resolver.define('createTestRunsForCycle', async ({ payload }) => {
  const { projectId, cycleId, cycleKey, testCases, config } = payload;
  const testRunType = config?.testRunType || 'Test Run';

  if (!testCases || testCases.length === 0) return { created: [], count: 0 };

  const snapshots = await mapWithConcurrency(testCases, 3, tc => getTestCaseSnapshot(tc.id || tc.key));
  const issuesToCreate = testCases.map((tc, idx) => ({
    fields: {
      project: { id: String(projectId) },
      summary: `[Run] ${tc.key || tc.id}: ${tc.summary || 'Test Case'}`.substring(0, 255),
      issuetype: { name: testRunType },
      description: ensureValidAdf(snapshots[idx]?.description, `Snapshot del caso ${tc.key || tc.id}: ${tc.summary || ''}`)
    }
  }));

  const createdRuns = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < issuesToCreate.length; i += BATCH_SIZE) {
    const batch = issuesToCreate.slice(i, i + BATCH_SIZE);
    const originalCases = testCases.slice(i, i + BATCH_SIZE);

    const res = await api.asUser().requestJira(route`/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: batch })
    });

    if (res.ok) {
      const data = await res.json();
      const createdIssues = data.issues || [];

      for (let j = 0; j < createdIssues.length; j++) {
        const runIssue = createdIssues[j];
        const tc = originalCases[j];

        // 1. Link Test Run -> Test Cycle
        await linkTwoIssues(runIssue.id, cycleId, 'Relates');

        // 2. Link Test Run -> Test Case
        if (tc.id) {
          await linkTwoIssues(runIssue.id, tc.id, 'Relates');
        }

        // 3. Initialize run property on the Test Run issue
        const initialRunData = {
          testCaseId: String(tc.id),
          testCaseKey: tc.key,
          cycleId: String(cycleId),
          cycleKey: cycleKey || String(cycleId),
          status: 'Not Run',
          iterations: [],
          comment: '',
          executedBy: null,
          executedAt: null
        };

        await api.asUser().requestJira(route`/rest/api/3/issue/${runIssue.id}/properties/testpulse-run-data`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(initialRunData)
        });

        createdRuns.push({
          testRunId: runIssue.id,
          testRunKey: runIssue.key,
          testCaseId: String(tc.id),
          testCaseKey: tc.key,
          summary: tc.summary,
          status: 'Not Run'
        });
      }
    } else {
      const errText = await res.text();
      console.error(`[createTestRunsForCycle] Bulk create failed: ${res.status} ${errText}`);
    }
  }

  // Mark cycle as V2 enabled
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testpulse-v2`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, migratedAt: Date.now() })
  });

  return { created: createdRuns, count: createdRuns.length };
});

// Resolver: Fetches all Test Runs for a Cycle (V2 Engine)
resolver.define('getCycleTestRuns', async ({ payload }) => {
  const { cycleId, projectId, config } = payload;
  const testRunType = config?.testRunType || 'Test Run';

  try {
    // 1. First check if cycle has linked Test Runs via JQL
    const jql = `issue in linkedIssues(${jqlQuote(cycleId)}) AND issuetype = ${jqlQuote(testRunType)} ORDER BY key ASC`;
    let allRuns = [];
    let token = null;
    let isLast = false;
    let pages = 0;

    while (!isLast && pages < 35) {
      const page = await fetchJqlPage(
        jql,
        ['summary', 'status', 'assignee', 'attachment', 'issuelinks', 'created', 'updated'],
        null,
        ['testpulse-run-data'],
        token,
        100
      );
      if (page.error) break;
      allRuns = allRuns.concat(page.issues);
      token = page.nextPageToken;
      isLast = page.isLast;
      pages++;
      if (!token) break;
    }

    if (allRuns.length === 0) {
      return { isV2: false, testRuns: [] };
    }

    const formattedRuns = allRuns.map(issue => {
      const runData = issue.properties?.['testpulse-run-data'] || {};
      
      // Extract linked bugs from issuelinks
      const linkedBugs = (issue.fields.issuelinks || []).map(link => {
        const linkedIssue = link.outwardIssue || link.inwardIssue;
        if (!linkedIssue) return null;
        const typeName = linkedIssue.fields?.issuetype?.name || '';
        if (typeName.toLowerCase().includes('run') || typeName.toLowerCase().includes('cycle') || typeName.toLowerCase().includes('case')) {
          return null;
        }
        return {
          id: linkedIssue.id,
          key: linkedIssue.key,
          summary: linkedIssue.fields?.summary || '',
          status: linkedIssue.fields?.status?.name || ''
        };
      }).filter(Boolean);

      return {
        id: runData.testCaseId || issue.id,
        testRunId: issue.id,
        testRunKey: issue.key,
        testCaseId: runData.testCaseId || issue.id,
        testCaseKey: runData.testCaseKey || '',
        summary: issue.fields.summary,
        status: issue.fields.status?.name || runData.status || 'Not Run',
        statusCategory: issue.fields.status?.statusCategory?.key || '',
        assignee: issue.fields.assignee,
        executedBy: runData.executedBy || issue.fields.assignee,
        executedAt: runData.executedAt,
        comment: runData.comment || '',
        iterations: runData.iterations || [],
        evidences: filterNonIterationEvidences(
          (issue.fields.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })).concat(runData.evidences || []),
          getIterationEvidenceKeys(runData.iterations)
        ),
        linkedBugs: linkedBugs.length > 0 ? linkedBugs : (runData.linkedBugs || [])
      };
    });

    return { isV2: true, testRuns: formattedRuns, count: formattedRuns.length };
  } catch (e) {
    console.error(`[getCycleTestRuns] Error fetching runs for cycle ${cycleId}:`, e);
    return { isV2: false, testRuns: [], error: e.message };
  }
});

// Resolver: Updates execution data and transitions the Test Run issue (V2)
resolver.define('updateTestRunExecution', async ({ payload, context }) => {
  const { testRunId, status, iterations, comment, evidences, linkedBugs, projectId, takeover } = payload;

  // 1. Fetch cached user profile and current run issue/property in parallel
  const [userData, runRes] = await Promise.all([
    getCachedMyself(context),
    api.asUser().requestJira(
      route`/rest/api/3/issue/${testRunId}?properties=testpulse-run-data&fields=status,assignee`
    ).catch(() => null)
  ]);

  let currentRunData = {};
  let currentAssigneeId = null;
  if (runRes && runRes.ok) {
    try {
      const runJson = await runRes.json();
      currentRunData = runJson?.properties?.['testpulse-run-data'] || {};
      currentAssigneeId = runJson?.fields?.assignee?.accountId || null;
    } catch (e) {}
  }

  let executorInfo = currentRunData.executedBy;
  if ((status && status !== 'Not Run' && userData) || (takeover && userData)) {
    executorInfo = {
      accountId: userData.accountId,
      displayName: userData.displayName
    };
  }

  const targetIterations = iterations !== undefined ? iterations : (currentRunData.iterations || []);
  const iterKeys = getIterationEvidenceKeys(targetIterations);
  const targetEvidences = evidences !== undefined ? evidences : (currentRunData.evidences || []);
  const cleanEvidences = filterNonIterationEvidences(targetEvidences, iterKeys);

  const updatedRunData = {
    ...currentRunData,
    status: status !== undefined ? status : currentRunData.status,
    iterations: targetIterations,
    comment: comment !== undefined ? comment : (currentRunData.comment || ''),
    evidences: cleanEvidences,
    linkedBugs: linkedBugs !== undefined ? linkedBugs : (currentRunData.linkedBugs || []),
    executedBy: executorInfo,
    executedAt: status && status !== 'Not Run' ? (currentRunData.executedAt || Date.now()) : currentRunData.executedAt
  };

  // 2. Save property on Test Run issue FIRST
  await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/properties/testpulse-run-data`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedRunData)
  });

  // 3. Execute secondary updates in parallel (status transition, conditional assignee, ADF comment)
  const secondaryTasks = [];

  if (status) {
    secondaryTasks.push(transitionJiraIssue(testRunId, status).catch(console.warn));
  }

  if (executorInfo?.accountId && currentAssigneeId !== executorInfo.accountId) {
    secondaryTasks.push(
      api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/assignee`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: executorInfo.accountId })
      }).catch(console.warn)
    );
  }

  if (updatedRunData.status !== 'Not Run' || updatedRunData.comment || (updatedRunData.iterations && updatedRunData.iterations.length > 0)) {
    const commentAdf = buildExecutionAdfComment({
      cycleKey: updatedRunData.cycleKey,
      testCaseKey: updatedRunData.testCaseKey,
      status: updatedRunData.status,
      comment: updatedRunData.comment,
      iterations: updatedRunData.iterations,
      executedBy: updatedRunData.executedBy
    });
    secondaryTasks.push(syncExecutionComment(testRunId, commentAdf).catch(console.warn));
  }

  await Promise.allSettled(secondaryTasks);
  await invalidateProjectReportCache(projectId || null);

  return { success: true, updated: updatedRunData };
});

// Resolver: Single Cycle Pilot Migration (V1 -> V2)



// ─── Snapshot extra sections (Precondición / Pasos / Resultados Esperados) ───
// Field IDs are auto-detected by name (accent/case-insensitive) and cached per runtime instance.
const SNAPSHOT_SECTION_DEFS = [
  { key: 'precondition', title: 'Precondiciones', patterns: [/precondici/, /pre-?condition/] },
  { key: 'steps', title: 'Pasos', patterns: [/^pasos\b/, /pasos de (la )?prueba/, /\btest steps?\b/, /^steps\b/] },
  { key: 'expected', title: 'Resultados Esperados', patterns: [/resultados? esperados?/, /expected results?/] }
];
let _snapshotFieldCache = { at: 0, map: null };
const _normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const resolveSnapshotFieldIds = async () => {
  if (_snapshotFieldCache.map && Date.now() - _snapshotFieldCache.at < 10 * 60 * 1000) return _snapshotFieldCache.map;
  const map = { precondition: [], steps: [], expected: [] };
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/field`);
    if (res.ok) {
      const fields = await res.json();
      for (const f of fields || []) {
        if (!f?.custom || !f.id) continue;
        const n = _normName(f.name);
        for (const def of SNAPSHOT_SECTION_DEFS) {
          if (def.patterns.some(p => p.test(n))) { map[def.key].push({ id: f.id, name: f.name }); break; }
        }
      }
    }
  } catch (e) {
    console.warn('[resolveSnapshotFieldIds] error:', e.message);
  }
  _snapshotFieldCache = { at: Date.now(), map };
  return map;
};

const _escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Converts a custom field raw value into ADF block nodes (or [] if empty/unsupported)
const _fieldValueToAdfNodes = (val) => {
  if (val == null) return [];
  if (typeof val === 'object' && val.type === 'doc' && Array.isArray(val.content)) {
    return val.content.length > 0 ? val.content : [];
  }
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return [];
    return t.split(/\r?\n/).map(line => line.trim()
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph', content: [] });
  }
  if (typeof val === 'object' && (val.value || val.name)) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: String(val.value || val.name) }] }];
  }
  return [];
};

const buildSnapshotSections = (fieldMap, fields, renderedFields) => {
  const adfNodes = [];
  let html = '';
  const included = [];
  for (const def of SNAPSHOT_SECTION_DEFS) {
    for (const f of (fieldMap?.[def.key] || [])) {
      const nodes = _fieldValueToAdfNodes(fields?.[f.id]);
      if (nodes.length === 0) continue;
      adfNodes.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: def.title }] }, ...nodes);
      const rendered = renderedFields?.[f.id];
      const bodyHtml = (typeof rendered === 'string' && rendered.trim())
        ? rendered
        : (typeof fields?.[f.id] === 'string' ? `<p>${_escHtml(fields[f.id]).replace(/\r?\n/g, '<br/>')}</p>` : '');
      html += `<h3>${def.title}</h3><div>${bodyHtml}</div>`;
      included.push({ section: def.key, fieldId: f.id, fieldName: f.name });
      break; // one field per section is enough
    }
  }
  return { adfNodes, html, included };
};

const getTestCaseSnapshot = async (testCaseIdOrKey) => {
  if (!testCaseIdOrKey) return null;
  try {
    const fieldMap = await resolveSnapshotFieldIds();
    const extraIds = [...fieldMap.precondition, ...fieldMap.steps, ...fieldMap.expected].map(f => f.id);
    const fieldList = [
      'description',
      'summary',
      'issuetype',
      'project',
      DEFAULT_CUSTOM_FIELDS.executionType,
      DEFAULT_CUSTOM_FIELDS.testLevel,
      DEFAULT_CUSTOM_FIELDS.testType,
      ...extraIds
    ].join(',');
    const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testCaseIdOrKey}?fields=${fieldList}&expand=renderedFields`);
    if (tcRes.ok) {
      const tcData = await tcRes.json();
      const executionType = extractExecutionTypeFromFields(tcData.fields);

      const baseAdf = ensureValidAdf(tcData.fields?.description, tcData.fields?.summary);
      const sections = buildSnapshotSections(fieldMap, tcData.fields, tcData.renderedFields);
      const hasOwnDesc = !!tcData.fields?.description;
      const mergedAdf = sections.adfNodes.length > 0
        ? { type: 'doc', version: 1, content: [...(hasOwnDesc ? (baseAdf.content || []) : []), ...sections.adfNodes] }
        : baseAdf;
      const baseHtml = tcData.renderedFields?.description || '';
      const mergedHtml = (baseHtml + sections.html) || null;

      return {
        id: tcData.id,
        key: tcData.key,
        projectId: tcData.fields?.project?.id,
        summary: tcData.fields?.summary || '',
        description: mergedAdf,
        renderedDescription: mergedHtml,
        includedSections: sections.included,
        executionType: executionType || 'Manual',
        rawFields: tcData.fields || {}
      };
    }
  } catch (e) {
    console.warn(`[getTestCaseSnapshot] Error for ${testCaseIdOrKey}:`, e.message);
  }
  return null;
};

// ─── Admin: re-sync Test Runs from their current Test Case (keeps audit history) ───
const _isProjectAdmin = async (projectId, context) => {
  return getCachedIsProjectAdmin(projectId, context);
};

resolver.define('getSnapshotFieldMapping', async () => {
  const map = await resolveSnapshotFieldIds();
  return map;
});

resolver.define('listCycleRunsForResync', async ({ payload, context }) => {
  const { projectId, cycleId } = payload || {};
  if (!(await _isProjectAdmin(projectId, context))) return { error: 'FORBIDDEN' };
  if (!cycleId) return { error: 'MISSING_CYCLE' };
  const entries = (await readCycleIndex(cycleId)) || [];
  const seen = new Set();
  const items = [];
  let withoutRun = 0;
  for (const e of entries) {
    if (!e.testRunId) { withoutRun++; continue; }
    if (seen.has(String(e.testRunId))) continue;
    seen.add(String(e.testRunId));
    items.push({ testRunId: String(e.testRunId), testRunKey: e.testRunKey || null, testCaseId: String(e.id || ''), testCaseKey: e.testCaseKey || e.key || '' });
  }
  return { items, withoutRun };
});

// ─── Tester & Bug assignment (Execution & BugSlidePanel) ───
resolver.define('searchAssignableUsers', async ({ payload }) => {
  const { issueKey, projectKey, projectId, query } = payload || {};
  const qStr = String(query || '').trim();
  const normText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const normalizeUsers = (arr) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const u of arr) {
      if (!u || !u.accountId) continue;
      if (u.active === false) continue;
      if (u.accountType === 'app') continue;
      if (seen.has(u.accountId)) continue;
      seen.add(u.accountId);
      out.push({
        accountId: u.accountId,
        displayName: u.displayName || u.name || u.emailAddress || u.accountId,
        email: u.emailAddress || null,
        avatarUrl: u.avatarUrls?.['24x24'] || u.avatarUrls?.['48x48'] || u.avatarUrls?.['32x32'] || null
      });
    }
    return out;
  };

  const filterUsersByQuery = (users, q) => {
    const nq = normText(q);
    if (!nq) return users;
    const tokens = nq.split(/\s+/).filter(Boolean);
    return users.filter(u => {
      const haystack = `${normText(u.displayName)} ${normText(u.email)}`;
      return tokens.every(tok => haystack.includes(tok));
    });
  };

  const fetchUsersFromEndpoint = async (jiraRoute) => {
    try {
      const resUser = await api.asUser().requestJira(jiraRoute);
      if (resUser.ok) {
        const data = await resUser.json();
        const list = normalizeUsers(Array.isArray(data) ? data : (data?.values || data?.users || []));
        if (list.length > 0) return list;
      }
    } catch (e) {
      console.warn('[searchAssignableUsers] asUser error:', e.message);
    }
    try {
      const resApp = await api.asApp().requestJira(jiraRoute);
      if (resApp.ok) {
        const data = await resApp.json();
        // Results fetched as the app bypass the user's e-mail visibility settings, so the
        // e-mail is dropped; name, avatar and accountId are enough to pick an assignee.
        const list = normalizeUsers(Array.isArray(data) ? data : (data?.values || data?.users || []))
          .map(u => ({ ...u, email: null }));
        if (list.length > 0) return list;
      }
    } catch (e) {
      console.warn('[searchAssignableUsers] asApp error:', e.message);
    }
    return [];
  };

  const validIssueKey = (issueKey && String(issueKey).includes('-') && String(issueKey) !== 'BUG')
    ? String(issueKey).trim()
    : null;
  const derivedKeyFromIssue = validIssueKey ? validIssueKey.split('-')[0] : null;

  let resolvedProjectKey = (projectKey && !/^\d+$/.test(String(projectKey).trim()))
    ? String(projectKey).trim()
    : derivedKeyFromIssue;
  const rawProjectRef = resolvedProjectKey || projectKey || projectId || null;

  try {
    // 1. Try assignable search by specific issueKey (most accurate for Bugs & Test Runs)
    if (validIssueKey) {
      const byIssue = await fetchUsersFromEndpoint(
        route`/rest/api/3/user/assignable/search?issueKey=${validIssueKey}&query=${qStr}&maxResults=50`
      );
      if (byIssue.length > 0) return byIssue.slice(0, 30);

      if (qStr) {
        const allForIssue = await fetchUsersFromEndpoint(
          route`/rest/api/3/user/assignable/search?issueKey=${validIssueKey}&maxResults=200`
        );
        const filteredIssue = filterUsersByQuery(allForIssue, qStr);
        if (filteredIssue.length > 0) return filteredIssue.slice(0, 30);
      }
    }

    // 2. If we only have a numeric projectId, resolve its project key so Jira assignable search always succeeds
    if (!resolvedProjectKey && rawProjectRef && /^\d+$/.test(String(rawProjectRef).trim())) {
      try {
        const pRes = await api.asUser().requestJira(route`/rest/api/3/project/${String(rawProjectRef).trim()}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData?.key) resolvedProjectKey = pData.key;
        }
      } catch (_) {}
    }

    const projectCandidates = Array.from(new Set([resolvedProjectKey, rawProjectRef].filter(Boolean).map(String)));
    for (const proj of projectCandidates) {
      const byProj = await fetchUsersFromEndpoint(
        route`/rest/api/3/user/assignable/search?project=${proj}&query=${qStr}&maxResults=50`
      );
      if (byProj.length > 0) return byProj.slice(0, 30);

      if (qStr) {
        const allForProj = await fetchUsersFromEndpoint(
          route`/rest/api/3/user/assignable/search?project=${proj}&maxResults=200`
        );
        const filteredProj = filterUsersByQuery(allForProj, qStr);
        if (filteredProj.length > 0) return filteredProj.slice(0, 30);
      }
    }

    // 3. Fallback: general Jira user search if project/issue assignable search returned empty
    const byUserSearch = await fetchUsersFromEndpoint(
      route`/rest/api/3/user/search?query=${qStr}&maxResults=50`
    );
    if (byUserSearch.length > 0) return filterUsersByQuery(byUserSearch, qStr).slice(0, 30);

    const allUsersFallback = await fetchUsersFromEndpoint(
      route`/rest/api/3/users/search?maxResults=200`
    );
    return filterUsersByQuery(allUsersFallback, qStr).slice(0, 30);
  } catch (e) {
    console.warn('[searchAssignableUsers] error:', e.message);
    return [];
  }
});

resolver.define('bulkAssignTestRuns', async ({ payload, context }) => {
  const { projectId, cycleId, items, user } = payload || {};
  if (!(await _isProjectAdmin(projectId, context))) return { error: 'FORBIDDEN' };
  const batch = (items || []).filter(it => it && it.testRunId).slice(0, 25);
  const accountId = user?.accountId || null; // null = unassign

  const results = await mapWithConcurrency(batch, 3, async (it) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api.asUser().requestJira(route`/rest/api/3/issue/${String(it.testRunId)}/assignee`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId })
        });
        if (r.status === 429) { await new Promise(res => setTimeout(res, 1000 * (attempt + 1) + Math.random() * 400)); continue; }
        if (!r.ok) {
          const txt = summarizeJiraError(await r.text().catch(() => ''));
          return { testRunId: it.testRunId, ok: false, reason: `${r.status} ${txt.slice(0, 120)}` };
        }
        return { testRunId: it.testRunId, ok: true };
      } catch (e) {
        if (attempt === 2) return { testRunId: it.testRunId, ok: false, reason: e.message };
      }
    }
    return { testRunId: it.testRunId, ok: false, reason: 'rate limit' };
  });

  // Note: the cycle index whitelists fields (no assignee); the Execution list reads the
  // assignee live from each Test Run issue, so no index write is needed here.
  return { results };
});

resolver.define('resyncTestRunsBatch', async ({ payload, context }) => {
  const { projectId, items } = payload || {};
  if (!(await _isProjectAdmin(projectId, context))) return { error: 'FORBIDDEN' };
  const batch = (items || []).slice(0, 10);
  const actor = context?.accountId || null;

  const results = await mapWithConcurrency(batch, 2, async (it) => {
    try {
      const runRes = await api.asUser().requestJira(route`/rest/api/3/issue/${it.testRunId}?fields=summary&properties=testpulse-run-data`);
      if (!runRes.ok) return { testRunId: it.testRunId, ok: false, reason: `run ${runRes.status}` };
      const runIssue = await runRes.json();
      const runData = runIssue.properties?.['testpulse-run-data'] || {};
      const tcRef = runData.testCaseId || runData.testCaseKey || it.testCaseId || it.testCaseKey;
      if (!tcRef) return { testRunId: it.testRunId, ok: false, reason: 'sin Test Case' };

      const tcSnapshot = await getTestCaseSnapshot(tcRef);
      if (!tcSnapshot) return { testRunId: it.testRunId, ok: false, reason: 'Test Case no accesible' };

      // 1. Update Run description (Jira changelog keeps the previous value too)
      const putRes = await api.asUser().requestJira(route`/rest/api/3/issue/${it.testRunId}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { description: tcSnapshot.description } })
      });
      if (!putRes.ok) return { testRunId: it.testRunId, ok: false, reason: `desc ${putRes.status}` };

      // 2. New snapshot + audit trail of the previous one (execution data untouched)
      const history = Array.isArray(runData.snapshotHistory) ? runData.snapshotHistory : [];
      if (runData.snapshot) {
        const { testCaseDescription, ...prevMeta } = runData.snapshot;
        history.unshift({
          ...prevMeta,
          testCaseDescription: typeof testCaseDescription === 'string' ? testCaseDescription.slice(0, 4000) : null,
          replacedAt: Date.now(),
          replacedBy: actor
        });
      }
      const newRunData = {
        ...runData,
        snapshot: {
          ...(runData.snapshot || {}),
          testCaseId: tcSnapshot.id,
          testCaseKey: tcSnapshot.key,
          testCaseSummary: tcSnapshot.summary,
          testCaseDescription: tcSnapshot.renderedDescription || null,
          includedSections: (tcSnapshot.includedSections || []).map(s => s.section),
          capturedAt: Date.now(),
          capturedBy: actor,
          source: 'admin-resync'
        },
        snapshotHistory: history.slice(0, 5)
      };
      let propRes = await api.asUser().requestJira(route`/rest/api/3/issue/${it.testRunId}/properties/testpulse-run-data`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(newRunData)
      });
      if (!propRes.ok && propRes.status !== 429) {
        // Property too large → keep only metadata in history
        newRunData.snapshotHistory = history.slice(0, 5).map(({ testCaseDescription, ...m }) => m);
        propRes = await api.asUser().requestJira(route`/rest/api/3/issue/${it.testRunId}/properties/testpulse-run-data`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(newRunData)
        });
      }
      return { testRunId: it.testRunId, ok: propRes.ok, reason: propRes.ok ? null : `prop ${propRes.status}`, sections: (tcSnapshot.includedSections || []).length };
    } catch (e) {
      return { testRunId: it.testRunId, ok: false, reason: e.message };
    }
  });
  return { results };
});

const buildExecutionAdfComment = ({ cycleKey, testCaseKey, status, comment, iterations, executedBy }) => {
  const content = [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: `📊 Resultado de Ejecución: ${status || 'Not Run'}` }]
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ciclo: ", marks: [{ type: "strong" }] },
        { type: "text", text: String(cycleKey || "N/A") + " | " },
        { type: "text", text: "Caso de Prueba: ", marks: [{ type: "strong" }] },
        { type: "text", text: String(testCaseKey || "N/A") + " | " },
        { type: "text", text: "Estado: ", marks: [{ type: "strong" }] },
        { type: "text", text: String(status || "Not Run") }
      ]
    }
  ];

  if (executedBy) {
    const dispName = typeof executedBy === 'object' ? (executedBy.displayName || executedBy.accountId) : String(executedBy);
    content.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Ejecutado por: ", marks: [{ type: "strong" }] },
        { type: "text", text: String(dispName) }
      ]
    });
  }

  if (comment && String(comment).trim()) {
    content.push({
      type: "paragraph",
      content: [
        { type: "text", text: "💬 Comentario: ", marks: [{ type: "strong" }] },
        { type: "text", text: String(comment).trim() }
      ]
    });
  }

  if (Array.isArray(iterations) && iterations.length > 0) {
    content.push({
      type: "heading",
      attrs: { level: 4 },
      content: [{ type: "text", text: `🔁 Iteraciones (${iterations.length})` }]
    });

    const listItems = [];
    iterations.forEach((iter, idx) => {
      const iterStatus = iter.status || "Passed";
      const expectedData = iter.expectedData ? String(iter.expectedData).trim() : "";
      const actualResult = iter.actualResult ? String(iter.actualResult).trim() : "";
      const pContent = [
        { type: "text", text: `Iteración #${idx + 1}`, marks: [{ type: "strong" }] }
      ];

      if (expectedData) {
        pContent.push({ type: "text", text: ` [${expectedData}]` });
      }
      pContent.push({ type: "text", text: ` — Estado: ${iterStatus}
` });

      if (actualResult) {
        pContent.push({ type: "text", text: "Comentario / Resultado: ", marks: [{ type: "strong" }] });
        pContent.push({ type: "text", text: `${actualResult}
` });
      }

      const evidences = iter.evidences || [];
      if (Array.isArray(evidences) && evidences.length > 0) {
        const evNames = evidences.map(e => typeof e === 'object' ? (e.filename || e.id) : String(e));
        pContent.push({ type: "text", text: "Adjuntos: ", marks: [{ type: "em" }] });
        pContent.push({ type: "text", text: evNames.join(", ") });
      }

      listItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: pContent }]
      });
    });

    content.push({
      type: "bulletList",
      content: listItems
    });
  }

  return { type: "doc", version: 1, content };
};

const syncExecutionComment = async (testRunId, commentAdf) => {
  if (!testRunId || !commentAdf) return;
  try {
    const commentsRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/comment`);
    let existingTestPulseComment = null;
    if (commentsRes.ok) {
      const commentsData = await commentsRes.json();
      const allComments = commentsData.comments || [];
      existingTestPulseComment = allComments.find(c => {
        const str = JSON.stringify(c.body || {});
        return str.includes('Resultado de Ejecución') || str.includes('Iteraciones');
      });
    }

    if (existingTestPulseComment) {
      await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/comment/${existingTestPulseComment.id}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentAdf })
      });
    } else {
      await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/comment`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentAdf })
      });
    }
  } catch (e) {
    console.warn(`[syncExecutionComment] Error for ${testRunId}:`, e.message);
  }
};

const copyAttachmentToIssue = async (sourceAttachmentIdOrUrl, filename, targetIssueId) => {
  if (!sourceAttachmentIdOrUrl || !targetIssueId) return null;
  try {
    let attachmentId = sourceAttachmentIdOrUrl;
    if (typeof sourceAttachmentIdOrUrl === 'object') {
      attachmentId = sourceAttachmentIdOrUrl.id || sourceAttachmentIdOrUrl.url;
    }
    if (typeof attachmentId === 'string' && attachmentId.includes('/')) {
      const match = attachmentId.match(/attachment\/(?:content\/)?(\d+)/);
      if (match) attachmentId = match[1];
    }

    if (!attachmentId || isNaN(Number(attachmentId))) {
      console.warn(`[copyAttachment] Invalid attachment ID:`, sourceAttachmentIdOrUrl);
      return null;
    }

    const getRes = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${attachmentId}`);
    if (!getRes.ok) {
      console.warn(`[copyAttachment] Could not fetch attachment ${attachmentId}: ${getRes.status}`);
      return null;
    }

    const arrayBuf = await getRes.arrayBuffer();
    const blob = new Blob([arrayBuf]);
    const formData = new FormData();
    formData.append('file', blob, filename || `attachment_${attachmentId}.png`);

    const postRes = await api.asUser().requestJira(route`/rest/api/3/issue/${targetIssueId}/attachments`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: formData
    });

    if (postRes.ok) {
      const json = await postRes.json();
      return json && json.length > 0 ? json[0] : null;
    } else {
      const errText = await postRes.text();
      console.warn(`[copyAttachment] Upload failed for issue ${targetIssueId}: ${postRes.status} ${errText}`);
      return null;
    }
  } catch (e) {
    console.error(`[copyAttachment] Exception copying attachment:`, e.message);
    return null;
  }
};

resolver.define('migrateCycleBatch', async ({ payload }) => {
  const { projectId, cycleId, cycleKey, batch, config } = payload;
  const testRunType = config?.testRunType || 'Test Run';

  if (!batch || batch.length === 0) return { created: [] };

  try {
    // 1. Fetch TestCase snapshots (description, summary) in parallel
    const snapshots = await Promise.all(batch.map(ex => getTestCaseSnapshot(ex.id || ex.key)));

    const issuesToCreate = batch.map((ex, idx) => {
      const tcSnapshot = snapshots[idx];
      const fallbackText = `Snapshot del caso ${ex.key || ex.id}: ${ex.summary || ''}`;
      const adfDesc = ensureValidAdf(tcSnapshot?.description, fallbackText);

      const fields = {
        project: { id: String(projectId) },
        summary: `[Run] ${ex.key || ex.id}: ${ex.summary || 'Test Case'}`.substring(0, 255),
        issuetype: { name: testRunType },
        // Exact 1:1 TestCase Description Snapshot!
        description: adfDesc
      };
      if (ex.executedBy?.accountId) {
        fields.assignee = { accountId: ex.executedBy.accountId };
      }
      return { fields };
    });

    const res = await api.asUser().requestJira(route`/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: issuesToCreate })
    });

    if (!res.ok) {
      const errText = summarizeJiraError(await res.text());
      console.error(`[migrateCycleBatch] Bulk create error: ${res.status} ${errText}`);
      return { success: false, error: errText };
    }

    const data = await res.json();
    const createdIssues = data.issues || [];
    const createdRuns = [];

    // Process all tests in this batch in parallel with Promise.all
    await Promise.all(createdIssues.map(async (runIssue, idx) => {
      const ex = batch[idx];
      const tcSnapshot = snapshots[idx];
      if (!ex) return;

      try {
        // 1. Link Test Run -> Cycle & Test Case & Bugs
        const linkPromises = [
          linkTwoIssues(runIssue.id, cycleId, 'Relates')
        ];
        if (ex.id) {
          linkPromises.push(linkTwoIssues(runIssue.id, ex.id, 'Relates'));
        }
        if (Array.isArray(ex.linkedBugs)) {
          for (const bug of ex.linkedBugs) {
            const bugKeyOrId = bug.key || bug.id;
            if (bugKeyOrId) linkPromises.push(linkTwoIssues(runIssue.id, bugKeyOrId, 'Blocks'));
          }
        }
        await Promise.all(linkPromises);

        // 2. Set Assignee explicitly (Tester)
        if (ex.executedBy?.accountId) {
          await api.asUser().requestJira(route`/rest/api/3/issue/${runIssue.id}/assignee`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: ex.executedBy.accountId })
          }).catch(err => console.warn(`[migrateCycleBatch] Assignee error for ${runIssue.id}:`, err.message));
        }

        // 3. Copy Physical Attachments to Test Run
        let updatedEvidences = [...(ex.evidences || [])];
        if (ex.evidence && updatedEvidences.length === 0) updatedEvidences.push(ex.evidence);

        const newEvidences = [];
        for (const ev of updatedEvidences) {
          const evId = typeof ev === 'object' ? (ev.id || ev.url) : ev;
          const evName = typeof ev === 'object' ? ev.filename : `evidence_${evId}.png`;
          const copied = await copyAttachmentToIssue(evId, evName, runIssue.id);
          if (copied) {
            newEvidences.push({ id: copied.id, filename: copied.filename, url: copied.content });
          } else {
            newEvidences.push(ev);
          }
        }

        const newIterations = [];
        if (Array.isArray(ex.iterations)) {
          for (const iter of ex.iterations) {
            const iterEvs = iter.evidences || [];
            const newIterEvs = [];
            for (const iev of iterEvs) {
              const ievId = typeof iev === 'object' ? (iev.id || iev.url) : iev;
              const ievName = typeof iev === 'object' ? iev.filename : `evidence_${ievId}.png`;
              const copied = await copyAttachmentToIssue(ievId, ievName, runIssue.id);
              if (copied) {
                newIterEvs.push({ id: copied.id, filename: copied.filename, url: copied.content });
              } else {
                newIterEvs.push(iev);
              }
            }
            newIterations.push({ ...iter, evidences: newIterEvs });
          }
        }

        // 4. Post Execution & Iterations as Jira Comment
        if (ex.status !== 'Not Run' || ex.comment || (ex.iterations && ex.iterations.length > 0)) {
          const commentAdf = buildExecutionAdfComment({
            cycleKey: cycleKey || cycleId,
            testCaseKey: ex.key || ex.id,
            status: ex.status || 'Not Run',
            comment: ex.comment,
            iterations: newIterations.length > 0 ? newIterations : (ex.iterations || []),
            executedBy: ex.executedBy
          });
          await syncExecutionComment(runIssue.id, commentAdf);
        }

        // 5. Save testpulse-run-data property (including TestCase snapshot)
        const runData = {
          testCaseId: String(ex.id),
          testCaseKey: ex.key || '',
          cycleId: String(cycleId),
          cycleKey: cycleKey || String(cycleId),
          status: ex.status || 'Not Run',
          iterations: newIterations.length > 0 ? newIterations : (ex.iterations || []),
          comment: ex.comment || '',
          executedBy: ex.executedBy || null,
          executedAt: ex.executedAt || null,
          evidences: newEvidences,
          snapshot: {
            testCaseId: ex.id,
            testCaseKey: ex.key,
            testCaseSummary: ex.summary,
            testCaseDescription: tcSnapshot?.renderedDescription || null,
            capturedAt: Date.now()
          }
        };

        await api.asUser().requestJira(route`/rest/api/3/issue/${runIssue.id}/properties/testpulse-run-data`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(runData)
        });

        // 6. Transition status if needed
        if (ex.status && ex.status !== 'Not Run') {
          await transitionJiraIssue(runIssue.id, ex.status);
        }

        createdRuns.push({
          testRunKey: runIssue.key,
          testRunId: runIssue.id,
          testCaseId: ex.id,
          status: ex.status
        });
      } catch (errItem) {
        console.warn(`[migrateCycleBatch] Error setting up run for ${ex.id}:`, errItem.message);
      }
    }));

    return { success: true, created: createdRuns };
  } catch (e) {
    console.error(`[migrateCycleBatch] Exception:`, e);
    return { success: false, error: e.message };
  }
});

resolver.define('syncCycleBatchTestRuns', async ({ payload }) => {
  const { batch, cycleKey } = payload;
  if (!batch || batch.length === 0) return { success: true, synced: 0 };

  try {
    let syncedCount = 0;
    await Promise.all(batch.map(async (item) => {
      const { testRunId, testExec } = item;
      if (!testRunId || !testExec) return;

      try {
        // 1. Fetch TestCase snapshot (description, summary)
        const tcSnapshot = await getTestCaseSnapshot(testExec.id || testExec.key);

        // 2. Set Description to exact TestCase Snapshot (restoring 1:1 test definition)
        if (tcSnapshot?.description) {
          await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { description: tcSnapshot.description } })
          }).catch(console.warn);
        }

        // 3. Update Assignee (Tester)
        if (testExec.executedBy?.accountId) {
          await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/assignee`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: testExec.executedBy.accountId })
          }).catch(console.warn);
        }

        // 4. Transition status if needed
        if (testExec.status && testExec.status !== 'Not Run') {
          await transitionJiraIssue(testRunId, testExec.status).catch(console.warn);
        }

        // 5. Copy Physical Attachments to Test Run if not present
        const issueRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}?fields=attachment`);
        let existingAttachments = [];
        if (issueRes.ok) {
          const issueData = await issueRes.json();
          existingAttachments = issueData.fields?.attachment || [];
        }
        const existingFilenames = new Set(existingAttachments.map(a => a.filename));

        let updatedEvidences = [...(testExec.evidences || [])];
        if (testExec.evidence && updatedEvidences.length === 0) updatedEvidences.push(testExec.evidence);

        const newEvidences = [];
        for (const ev of updatedEvidences) {
          const evId = typeof ev === 'object' ? (ev.id || ev.url) : ev;
          const evName = typeof ev === 'object' ? ev.filename : `evidence_${evId}.png`;
          if (!existingFilenames.has(evName)) {
            const copied = await copyAttachmentToIssue(evId, evName, testRunId);
            if (copied) {
              newEvidences.push({ id: copied.id, filename: copied.filename, url: copied.content });
              existingFilenames.add(copied.filename);
            } else {
              newEvidences.push(ev);
            }
          } else {
            const match = existingAttachments.find(a => a.filename === evName);
            newEvidences.push(match ? { id: match.id, filename: match.filename, url: match.content } : ev);
          }
        }

        const newIterations = [];
        if (Array.isArray(testExec.iterations)) {
          for (const iter of testExec.iterations) {
            const iterEvs = iter.evidences || [];
            const newIterEvs = [];
            for (const iev of iterEvs) {
              const ievId = typeof iev === 'object' ? (iev.id || iev.url) : iev;
              const ievName = typeof iev === 'object' ? iev.filename : `evidence_${ievId}.png`;
              if (!existingFilenames.has(ievName)) {
                const copied = await copyAttachmentToIssue(ievId, ievName, testRunId);
                if (copied) {
                  newIterEvs.push({ id: copied.id, filename: copied.filename, url: copied.content });
                  existingFilenames.add(copied.filename);
                } else {
                  newIterEvs.push(iev);
                }
              } else {
                const match = existingAttachments.find(a => a.filename === ievName);
                newIterEvs.push(match ? { id: match.id, filename: match.filename, url: match.content } : iev);
              }
            }
            newIterations.push({ ...iter, evidences: newIterEvs });
          }
        }

        // 6. Post Execution Results, Comments & Iterations as Jira Comment!
        if (testExec.status !== 'Not Run' || testExec.comment || (testExec.iterations && testExec.iterations.length > 0)) {
          const commentAdf = buildExecutionAdfComment({
            cycleKey: testExec.cycleKey || cycleKey,
            testCaseKey: testExec.key || testExec.id,
            status: testExec.status,
            comment: testExec.comment,
            iterations: newIterations.length > 0 ? newIterations : (testExec.iterations || []),
            executedBy: testExec.executedBy
          });
          await syncExecutionComment(testRunId, commentAdf);
        }

        // 7. Update property with snapshot
        const runData = {
          testCaseId: String(testExec.id),
          testCaseKey: testExec.key || '',
          status: testExec.status || 'Not Run',
          iterations: newIterations.length > 0 ? newIterations : (testExec.iterations || []),
          comment: testExec.comment || '',
          executedBy: testExec.executedBy || null,
          executedAt: testExec.executedAt || null,
          evidences: newEvidences,
          snapshot: {
            testCaseId: testExec.id,
            testCaseKey: testExec.key,
            testCaseSummary: testExec.summary,
            testCaseDescription: tcSnapshot?.renderedDescription || null,
            capturedAt: Date.now()
          }
        };

        await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/properties/testpulse-run-data`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(runData)
        });

        syncedCount++;
      } catch (err) {
        console.warn(`[syncCycleBatchTestRuns] Error syncing ${testRunId}:`, err.message);
      }
    }));

    return { success: true, synced: syncedCount };
  } catch (e) {
    console.error(`[syncCycleBatchTestRuns] Exception:`, e);
    return { success: false, error: e.message };
  }
});

resolver.define('finalizeCycleMigration', async ({ payload }) => {
  const { cycleId, totalMigrated } = payload;
  try {
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testpulse-v2`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, migratedAt: Date.now(), totalMigrated: totalMigrated || 0 })
    });
    return { success: true };
  } catch (e) {
    console.error(`[finalizeCycleMigration] Error:`, e);
    return { success: false, error: e.message };
  }
});


resolver.define('getProjectCyclesMigrationStatus', async ({ payload }) => {
  const { projectId, config } = payload;
  const cycleType = config?.testCycleType || 'Test Cycle';

  try {
    const jql = `project = ${jqlQuote(projectId)} AND issuetype = ${jqlQuote(cycleType)} ORDER BY created DESC`;
    let allIssues = [];
    let token = null;
    let isLast = false;
    while (!isLast) {
      const page = await fetchJqlPage(jql, ['summary', 'issuetype', 'created'], null, ['testops-plan-link', 'testpulse-v2'], token, 100);
      if (page.error) break;
      allIssues = allIssues.concat(page.issues);
      token = page.nextPageToken;
      isLast = page.isLast;
      if (!token) break;
    }

    const cyclesStatus = await Promise.all(allIssues.map(async (issue) => {
      const v2Prop = issue.properties?.['testpulse-v2'];
      const isV2 = Boolean(v2Prop?.enabled);
      const migratedAt = v2Prop?.migratedAt || null;
      const planId = issue.properties?.['testops-plan-link']?.planId || null;

      let testCount = 0;
      const index = await readCycleIndex(issue.id);
      if (index && Array.isArray(index)) {
        testCount = index.length;
      } else {
        const keysRes = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/properties`);
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          const execKeys = (keysData.keys || []).map(k => k.key).filter(k => k.startsWith('exec_'));
          testCount = execKeys.length;
        }
      }

      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary || issue.key,
        created: issue.fields?.created || null,
        planId,
        isV2,
        migratedAt,
        totalTests: testCount,
        totalMigrated: v2Prop?.totalMigrated || (isV2 ? testCount : 0)
      };
    }));

    return { success: true, cycles: cyclesStatus };
  } catch (e) {
    console.error('[getProjectCyclesMigrationStatus] Error:', e);
    return { success: false, error: e.message, cycles: [] };
  }
});


// =========================================================================
// === REPORT AUTOMATION & JIRA AUTOMATION WEBHOOK DISPATCH RESOLVERS ===
// =========================================================================
registerReportAutomationResolvers(resolver, { getAppStorage, setAppStorage });
export const scheduledReportHandler = createScheduledReportHandler({ getAppStorage, setAppStorage });

// ==========================================
// MOBILE COMPANION / QR EVIDENCE UPLOAD
// ==========================================
registerMobileCompanionResolvers(resolver);
export const mobileUploadHandler = modularMobileUploadHandler;

export const handler = resolver.getDefinitions();

