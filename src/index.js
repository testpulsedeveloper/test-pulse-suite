import Resolver from '@forge/resolver';
import api, { route, fetch } from '@forge/api';

const getAppStorage = async (key) => {
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/app/properties/${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.value?.data ?? data.value ?? null;
  } catch (_) {
    return null;
  }
};

const setAppStorage = async (key, val) => {
  try {
    await api.asApp().requestJira(route`/rest/api/3/app/properties/${key}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: val })
    });
    return true;
  } catch (_) {
    return false;
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
  }
  return allIssues;
}

async function fetchJqlPage(jql, fields, expand, properties, nextPageToken = null, maxResults = 100, retries = 2) {
  try {
    let safeFields = fields;
    if (Array.isArray(fields) && fields.includes('*all')) {
      safeFields = ['summary', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
      fields.forEach(f => {
        if (f !== '*all' && !safeFields.includes(f)) safeFields.push(f);
      });
    } else if (fields === '*all') {
      safeFields = ['summary', 'status', 'created', 'issuetype', 'priority', 'assignee', 'reporter', 'resolution', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'customfield_10568', 'customfield_10569', 'customfield_10570'];
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
      const delay = (4 - retries) * 1200 + Math.floor(Math.random() * 800);
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

resolver.define('probeAPI', async () => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql: "project IS NOT EMPTY", maxResults: 1 })
      });
      const data = await response.json();
      return { keys: Object.keys(data), hasIssues: !!data.issues, hasValues: !!data.values, issueKeys: data.issues ? Object.keys(data.issues[0] || {}) : null, valueKeys: data.values ? Object.keys(data.values[0] || {}) : null };
    } catch(err) {
      return { error: err.message };
    }
});


// === Evidences Deduplication Helper ===
const dedupeEvidences = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const ev of list) {
    if (!ev) continue;
    const evId = typeof ev === 'string' ? ev : (ev.id ? String(ev.id) : null);
    const evUrl = typeof ev === 'object' && ev.url ? String(ev.url) : null;
    const evName = typeof ev === 'object' && ev.filename ? String(ev.filename) : (typeof ev === 'string' ? ev : null);
    
    const key = evId ? `id:${evId}` : (evUrl ? `url:${evUrl}` : (evName ? `name:${evName}` : JSON.stringify(ev)));
    if (!seen.has(key)) {
      seen.add(key);
      result.push(typeof ev === 'string' ? { id: ev, filename: `evidence_${ev}.jpg` } : ev);
    }
  }
  return result;
};

// === Atlassian Document Format (ADF) Helper ===
const ensureValidAdf = (desc, fallbackText = '') => {
  if (desc && typeof desc === 'object' && desc.type === 'doc' && Array.isArray(desc.content)) {
    return desc;
  }
  let text = fallbackText;
  if (typeof desc === 'string' && desc.trim()) {
    text = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: text || 'Snapshot del caso de prueba'
          }
        ]
      }
    ]
  };
};

// === Folder Management (Jira Entity Properties) ===
const getProjectFolders = async (projectId) => {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`);
    if (response.status === 404 || !response.ok) return [];
    const data = await response.json();
    return data.value || [];
  } catch(e) {
    console.error("Error getProjectFolders:", e);
    return [];
  }
};

const setProjectFolders = async (projectId, data) => {
  await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

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
  const updatedFolders = folders.map(f => f.id === folderId ? { ...f, name: newName } : f);
  await setProjectFolders(projectId, updatedFolders);
  return updatedFolders;
});

resolver.define('deleteFolder', async ({ payload, context }) => {
  const { projectId, folderId } = payload;
  // Solo los admin pueden borrar carpetas
  const permissionRes = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`);
  if (permissionRes.ok) {
    const permissionData = await permissionRes.json();
    if (!permissionData?.permissions?.ADMINISTER_PROJECTS?.havePermission) {
      throw new Error("Only Project Admins can delete folders");
    }
  } else {
    throw new Error("Failed to check permissions");
  }

  const folders = await getProjectFolders(projectId);
  let toDelete = [folderId];
  let previousSize = 0;
  while(toDelete.length > previousSize) {
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

// === Project Management & Configuration ===
resolver.define('getProjects', async () => {
  try {
    let response = await api.asUser().requestJira(route`/rest/api/3/project`);
    let data = null;
    if (response.ok) {
      data = await response.json();
    } else {
      // Fallback to asApp() in case of user permission scheme quirks
      response = await api.asApp().requestJira(route`/rest/api/3/project`);
      if (response.ok) {
        data = await response.json();
      }
    }

    if (!data) return [];
    let projects = Array.isArray(data) ? data : (data.values || []);
    if (projects.length === 0) return [];
    
    return projects.map(p => ({ id: p.id, key: p.key, name: p.name }));
  } catch (err) {
    return { error: `Exception: ${err ? err.message || String(err) : "Unknown error"}` };
  }
});

resolver.define('getProjectIssueTypes', async ({ payload }) => {
  try {
    const { projectId } = payload;
    const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}`);
    if (!response.ok) return [];
    const data = await response.json();
    if (!data.issueTypes) return [];
    return data.issueTypes.map(type => ({
      id: type.id,
      name: type.name,
      iconUrl: type.iconUrl
    }));
  } catch (e) {
    return [];
  }
});

resolver.define('getIssueLinkTypes', async () => {
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/issueLinkType`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.issueLinkTypes || [];
  } catch(e) {
    console.error("Error getIssueLinkTypes:", e);
    return [];
  }
});

resolver.define('getConfig', async ({ payload }) => {
  const { projectId } = payload;
  if (!projectId) {
    return { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set', testRunType: 'Test Run', requirementIssueTypes: [], requirementLinkType: 'ANY' };
  }

  let retries = 3;
  while (retries >= 0) {
    try {
      const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
      if (response.status === 429) {
        retries--;
        if (retries < 0) break;
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 600));
        continue;
      }
      if (response.status === 404) {
        return { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set', testRunType: 'Test Run', requirementIssueTypes: [], requirementLinkType: 'ANY' };
      }
      if (!response.ok) {
        retries--;
        if (retries < 0) break;
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      const data = await response.json();
      const config = data?.value || {};
      return {
        testCaseType: config.testCaseType || 'Test Case',
        testCycleType: config.testCycleType || 'Test Cycle',
        planIssueType: config.planIssueType || 'Test Set',
        testRunType: config.testRunType || 'Test Run',
        requirementIssueTypes: Array.isArray(config.requirementIssueTypes) ? config.requirementIssueTypes : [],
        requirementLinkType: config.requirementLinkType || 'ANY',
        ...config
      };
    } catch (e) {
      retries--;
      if (retries < 0) break;
      await new Promise(r => setTimeout(r, 600));
    }
  }
  return { testCaseType: 'Test Case', testCycleType: 'Test Cycle', planIssueType: 'Test Set', testRunType: 'Test Run', requirementIssueTypes: [], requirementLinkType: 'ANY' };
});

resolver.define('setConfig', async ({ payload }) => {
  const { projectId, config } = payload;
  const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  return { success: response.status >= 200 && response.status < 300 };
});

// === Permissions ===
resolver.define('checkAdminPermission', async ({ payload }) => {
  try {
    const { projectId } = payload;
    const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`);
    if (!response.ok) return false;
    const data = await response.json();
    return data?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
  } catch(e) {
    console.error("checkAdminPermission error:", e);
    return false;
  }
});

// === Test Issue Queries ===
resolver.define('getTestPlans', async ({ payload }) => {
  try {
    const { projectId, config } = payload;
    const planType = config?.planIssueType;
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    
    const validPlanTypes = Array.from(new Set([
      planType,
      'Test Plan',
      'Test Set',
      'Plan de pruebas',
      'Plan de Pruebas',
      'TestPlan',
      'TestSet'
    ].filter(t => typeof t === 'string' && t.trim().length > 0)));

    const jql = `${projectJql}issuetype in (${validPlanTypes.map(t => `"${t}"`).join(', ')}) ORDER BY created DESC`;
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, null);
    return allIssues.map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary || issue.key,
      status: issue.fields?.status?.name || 'To Do'
    }));
  } catch (e) {
    console.error("getTestPlans exception:", e);
    return [];
  }
});

resolver.define('getTestCycles', async ({ payload }) => {
  try {
    const { projectId, config } = payload;
    const cycleType = config?.testCycleType;
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    
    const validCycleTypes = Array.from(new Set([
      cycleType,
      'Test Cycle',
      'Ciclo de prueba',
      'Ciclo de Prueba',
      'Ciclo',
      'TestCycle'
    ].filter(t => typeof t === 'string' && t.trim().length > 0)));

    const jql = `${projectJql}issuetype in (${validCycleTypes.map(t => `"${t}"`).join(', ')}) ORDER BY created DESC`;
    // Pass at most 3 properties (Jira allows max 5)
    const propNames = ['testops-plan-link', 'execution', 'tests'];
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, propNames);
    return allIssues.map(issue => {
      const props = issue.properties || {};
      let totalTests = 0;
      const seenIds = new Set();
      
      const rawExec = props['execution'];
      const execVal = Array.isArray(rawExec) ? rawExec : (Array.isArray(rawExec?.value) ? rawExec.value : null);
      if (Array.isArray(execVal)) {
        for (const item of execVal) {
          const id = typeof item === 'object' && item !== null ? String(item.id || item.testCaseId || '') : String(item);
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            totalTests++;
          }
        }
      }
      
      const rawTests = props['tests'];
      const testsVal = Array.isArray(rawTests) ? rawTests : (Array.isArray(rawTests?.value) ? rawTests.value : null);
      if (totalTests === 0 && Array.isArray(testsVal)) {
        for (const item of testsVal) {
          const id = typeof item === 'object' && item !== null ? String(item.id || item.testCaseId || '') : String(item);
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            totalTests++;
          }
        }
      }
      
      const planLink = props['testops-plan-link'];
      const planId = (planLink && typeof planLink === 'object') ? (planLink.planId || planLink.value?.planId || null) : null;
      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields?.summary || issue.key,
        status: issue.fields?.status?.name || 'To Do',
        planId,
        testCount: totalTests
      };
    });
  } catch (e) {
    console.error("getTestCycles exception:", e);
    return [];
  }
});

resolver.define('linkCycleToPlan', async ({ payload }) => {
  const { cycleId, planId } = payload;
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  });
  return true;
});

resolver.define('unlinkCycleFromPlan', async ({ payload }) => {
  const { cycleId } = payload;
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/testops-plan-link`, {
    method: 'DELETE'
  });
  return true;
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
      return { _isError: true, status: response.status, message: await response.text() };
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
  const tcType = config?.testCaseType;
  
  const projectJql = projectId ? `project = ${projectId} AND ` : '';
  const validTcTypes = Array.from(new Set([
    tcType,
    'Test Case',
    'Caso de prueba',
    'Caso de Prueba',
    'Prueba',
    'Test',
    'TestCase'
  ].filter(t => typeof t === 'string' && t.trim().length > 0)));

  const jql = `${projectJql}issuetype in (${validTcTypes.map(t => `"${t}"`).join(', ')}) ORDER BY created DESC`;
  
  let fieldsToFetch = ['summary', 'status', 'created', 'issuelinks', 'issuetype', 'priority', 'labels', 'customfield_10014', 'customfield_10534', 'customfield_10530', 'customfield_10535', 'reporter', 'creator', 'assignee'];
  if (payload?.executionTypeFieldId) {
     fieldsToFetch.push(payload.executionTypeFieldId);
  }
  if (config?.testLevelFieldId) {
     fieldsToFetch.push(config.testLevelFieldId);
  }
  if (config?.testTypeFieldId) {
     fieldsToFetch.push(config.testTypeFieldId);
  }
  
  const pageData = await fetchJqlPage(jql, fieldsToFetch, null, ['testops-folder-link'], nextPageToken, 100);
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
    const requirementTypes = payload?.config?.requirementIssueTypes || [];
    
    if (!requirementTypes || requirementTypes.length === 0) {
      return [];
    }
    
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    const typeList = requirementTypes.map(t => `"${t}"`).join(', ');
    const jql = `${projectJql}issuetype IN (${typeList}) ORDER BY created DESC`;
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        fields: ['summary', 'issuetype', 'parent', 'customfield_10014', 'status'],
        maxResults: 100
      })
    });
    
    if (!response.ok) {
      return { _isError: true, status: response.status };
    }
    const data = await response.json();
    return data.issues || [];
  } catch (e) {
    console.error("getRequirements exception:", e);
    return { _isError: true, message: String(e) };
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
  const { summary, description, projectId } = req.payload;
  // This requires the "Test Set" issue type to exist in the Jira project
  const body = {
    fields: {
      summary: summary,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }]
      },
      project: { id: projectId },
      issuetype: { name: "Test Set" }
    }
  };
  
  const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
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
  const { summary, description, projectId } = req.payload;
  
  // Fetch configured testCycleType
  const configResponse = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-config`);
  const config = configResponse.status === 200 ? (await configResponse.json()).value : {};
  const cycleType = config?.testCycleType || 'Test Cycle';

  const body = {
    fields: {
      summary: summary,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }]
      },
      project: { id: projectId },
      issuetype: { name: cycleType }
    }
  };
  
  const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
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
// Instead of one large property (which hits the 32KB limit at ~200 tests),
// we shard the index into multiple properties of SHARD_SIZE entries each.
// Shard 0: /properties/execution  (backward compat with existing data)
// Shard N: /properties/execution_N  (N = 1, 2, 3…)
// 200 entries × ~150 bytes ≈ 30KB — safely under the 32KB per-property limit.
const SHARD_SIZE = 100;
const _shardProp = (shard) => shard === 0 ? 'execution' : `execution_${shard}`;

// Returns:
//   null  → shard 0 is 404 (cycle has never had an index — use Tier 2 exec_ scan)
//   []    → shard 0 exists with empty array (index was explicitly cleared — do NOT use Tier 2)
//   [...] → tests in the index
const readCycleIndex = async (cycleId) => {
  const allEntries = [];
  for (let shard = 0; shard <= 25; shard++) {          // max 25 shards = 2500+ tests
    const propName = _shardProp(shard);
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${cycleId}/properties/${propName}?t=${Date.now()}`
    );
    if (res.status === 404) {
      if (shard === 0) return null; // ← No index ever created for this cycle
      break;                         // No more shards beyond this point
    }
    if (!res.ok) break;
    const data = await res.json();
    const raw = data.value || [];
    if (!Array.isArray(raw) || raw.length === 0) {
      if (shard === 0) return [];
      break;
    }
    const normalized = (typeof raw[0] === 'string')
      ? raw.map(id => ({ id: String(id), status: 'Not Run', linkedBugs: [] }))
      : raw;
    allEntries.push(...normalized);
  }
  return allEntries; // [] = explicitly cleared, [...] = has tests
};

const writeCycleIndex = async (cycleId, entries) => {
  // ALWAYS write at least shard 0, even for empty arrays.
  // An empty shard 0 is the "explicitly cleared" sentinel that prevents
  // getCycleExecutionSummary Tier 2 from resurrecting deleted tests via exec_ scan.
  const shardCount = entries.length === 0 ? 1 : Math.ceil(entries.length / SHARD_SIZE);
  for (let shard = 0; shard < shardCount; shard++) {
    const propName = _shardProp(shard);
    const shardEntries = entries.slice(shard * SHARD_SIZE, (shard + 1) * SHARD_SIZE);
    let res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${cycleId}/properties/${propName}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(shardEntries)
      }
    );
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1200));
      res = await api.asUser().requestJira(
        route`/rest/api/3/issue/${cycleId}/properties/${propName}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(shardEntries)
        }
      );
    }
    if (!res.ok) console.error(`[writeCycleIndex] Shard ${shard} write failed: ${res.status}`);
    if (shard < shardCount - 1) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // Clean up any remaining trailing shards
  for (let oldShard = shardCount; oldShard <= 25; oldShard++) {
    const propName = _shardProp(oldShard);
    api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${propName}`, {
      method: 'DELETE'
    }).catch(() => {});
  }
};

const deleteCycleIndex = async (cycleId) => {
  for (let shard = 0; shard <= 10; shard++) {
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${cycleId}/properties/${_shardProp(shard)}`,
      { method: 'DELETE' }
    );
    if (res.status === 404) break; // no more shards
  }
};


function normalizeJiraStatus(status) {
  if (!status) return 'Not Run';
  const s = String(status).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // removes accents: éxito -> exito, ejecución -> ejecucion
    
  // 1. PASSED / LISTO / ÉXITO / APROBADO / RESUELTO / FINALIZADO
  if ([
    'passed', 'pass', 'listo', 'done', 'aprobado', 'aprobada', 'exito', 'exitoso', 'exitosa',
    'finalizado', 'finalizada', 'completado', 'completada', 'terminado', 'terminada',
    'resuelto', 'resuelta', 'resolved', 'closed', 'cerrado', 'cerrada', 'ok',
    'satisfactorio', 'satisfactoria', 'superado', 'superada', 'conforme', 'validated',
    'validado', 'validada', 'accepted', 'aceptado', 'aceptada', 'success', 'successful'
  ].includes(s)) return 'Passed';

  // 2. FAILED / FALLIDO / RECHAZADO / ERROR
  if ([
    'failed', 'fail', 'fallido', 'fallida', 'fallo', 'rechazado', 'rechazada',
    'error', 'defectuoso', 'defectuosa', 'no superado', 'no superada', 'no conforme',
    'no paso', 'rejected', 'failing', 'bug', 'descartado', 'descartada'
  ].includes(s)) return 'Failed';

  // 3. BLOCKED / BLOQUEADO / IMPEDIDO
  if ([
    'blocked', 'block', 'bloqueado', 'bloqueada', 'bloqueo', 'impedido', 'impedida',
    'detenido', 'detenida', 'pausado', 'pausada', 'on hold', 'hold', 'detener', 'bloq'
  ].includes(s)) return 'Blocked';

  // 4. IN PROGRESS / EN CURSO / EN PROGRESO / TESTING
  if ([
    'in progress', 'en curso', 'en progreso', 'running', 'en desarrollo', 'en pruebas',
    'en ejecucion', 'en revision', 'testing', 'qa', 'in review', 'ejecutando',
    'en proceso', 'work in progress', 'wip'
  ].includes(s)) return 'In Progress';

  // 5. NOT RUN / TO DO / POR HACER / PENDIENTE / ABIERTO
  if ([
    'not run', 'to do', 'por hacer', 'pendiente', 'abierto', 'open', 'backlog',
    'nuevo', 'new', 'sin ejecutar', 'none', 'unexecuted', 'draft', 'borrador',
    'por probar', 'to test', 'untested'
  ].includes(s)) return 'Not Run';

  return status;
}

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

async function createTestRunsInJiraForCycle({ projectId, cycleId, cycleKey, testCases, config }) {
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

  // Step 1: Check for existing linked Test Runs in Jira for this cycle (Auto-Recovery)
  // Use only linkedIssues query — fast and sufficient
  try {
    let candidateRuns = await fetchAllIssues(
      `issue in linkedIssues("${cycleId}")`,
      ['summary', 'status', 'description', 'assignee', 'created', 'issuelinks', 'attachment', 'priority', 'customfield_10534', 'customfield_10530'],
      null,
      ['testpulse-run-data'],
      50
    );
    if (!Array.isArray(candidateRuns)) candidateRuns = [];

    for (const tc of testCases) {
      const tcIdStr = String(tc.id);
      const tcKeyStr = tc.key ? String(tc.key) : '';

      // Find if an existing run matches this test case and this cycle
      const existingRun = candidateRuns.find(r => {
        const prop = r.properties?.['testpulse-run-data'] || {};
        const matchesCycle = String(prop.cycleId) === String(cycleId) || prop.cycleKey === String(cycleKey);
        const matchesTc = String(prop.testCaseId) === tcIdStr || prop.testCaseKey === tcKeyStr || (tcKeyStr && r.fields?.summary?.includes(`[Run] ${tcKeyStr}:`)) || (tcKeyStr && r.fields?.summary?.includes(tcKeyStr));
        return matchesCycle && matchesTc;
      });

      if (existingRun) {
        // RECONECTAR / AUTO-RECUPERAR
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
            testCaseKey: tcKeyStr,
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
            evidences: dedupeEvidences([
              ...(existingRun.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
              ...(existingProp.evidences || [])
            ]),
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

  // Step 2: Fresh creation for test cases that did not have prior executions
  if (testCasesToCreate.length > 0) {
    const snapshots = await Promise.all(testCasesToCreate.map(tc => getTestCaseSnapshot(tc.id || tc.key)));

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
        // Parallelize linking and property assignment
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

        const postOperations = [
          linkTwoIssues(runIssue.id, cycleId, 'Relates'),
          api.asUser().requestJira(route`/rest/api/3/issue/${runIssue.id}/properties/testpulse-run-data`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(runData)
          })
        ];

        if (tc.id) {
          postOperations.push(linkTwoIssues(runIssue.id, tc.id, 'Relates'));
        }

        await Promise.all(postOperations);

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

const getCycleExecutionSummary = async (cycleId) => {
  try {
    // 1. Fetch native Test Runs linked to this cycle in real time via JQL
    const jql = `issue in linkedIssues("${cycleId}")`;
    const runIssues = await fetchAllIssues(
      jql,
      ['summary', 'status', 'description', 'assignee', 'created', 'issuelinks', 'attachment', 'priority', 'customfield_10534', 'customfield_10530'],
      null,
      ['testpulse-run-data'],
      50
    );

    if (Array.isArray(runIssues) && runIssues.length > 0) {
      const validRuns = runIssues.filter(run => {
        const summary = run.fields?.summary || '';
        const prop = run.properties?.['testpulse-run-data'];
        const type = run.fields?.issuetype?.name || '';
        const isRunType = ['Test Run', 'TestRun', 'Ejecución de prueba', 'Ejecución', 'Test Execution'].some(t => type.toLowerCase().includes(t.toLowerCase()));
        const isTcType = ['Test Case', 'TestCase', 'Caso de prueba', 'Caso de Prueba', 'Prueba', 'Test', 'Tarea', 'Task'].some(t => type.toLowerCase().includes(t.toLowerCase()));
        return prop || summary.startsWith('[Run]') || isRunType || isTcType;
      });

      if (validRuns.length > 0) {
        // Map each run to its resolved tcId/tcKey and full data object
        const mappedRuns = validRuns.map(run => {
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
            if (match && match[1]) tcKey = match[1];
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
          const isGenericDesc = typeof runDesc === 'string' && runDesc.includes('Test Run execution for test case');
          const effectiveDesc = runData.snapshot?.testCaseDescription || (!isGenericDesc ? runDesc : null) || null;

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
            executionType: runData.executionType || runData.snapshot?.executionType || (run.fields?.customfield_10534 ? (run.fields.customfield_10534.value || run.fields.customfield_10534) : 'Manual'),
            assignee: run.fields?.assignee || null,
            executedBy: runData.executedBy || (run.fields?.assignee ? { displayName: run.fields.assignee.displayName, accountId: run.fields.assignee.accountId } : null),
            executedAt: runData.executedAt || null,
            evidences: dedupeEvidences([
              ...(run.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
              ...(runData.evidences || [])
            ]),
            iterations: runData.iterations || [],
            comment: runData.comment || '',
            linkedBugs: (runData.linkedBugs && runData.linkedBugs.length > 0)
              ? runData.linkedBugs
              : (run.fields?.issuelinks || [])
                  .filter(l => l.type?.name === 'Blocks' || l.outwardIssue?.fields?.issuetype?.name?.toLowerCase().includes('bug') || l.inwardIssue?.fields?.issuetype?.name?.toLowerCase().includes('bug'))
                  .map(l => {
                    const linked = l.outwardIssue || l.inwardIssue;
                    return {
                      key: linked?.key,
                      summary: linked?.fields?.summary,
                      status: linked?.fields?.status?.name,
                      priority: linked?.fields?.priority?.name
                    };
                  }).filter(b => !!b.key),
            lockedAt: runData.lockedAt || null,
            _detailLoaded: false
          };
        });

        // DEDUPLICATION: group by testCaseId AND testCaseKey, keep best run per TC, unlink/delete duplicate blanks
        const byKey = new Map();
        for (const entry of mappedRuns) {
          const tcKey = entry.testCaseKey || entry.key;
          const tcId = entry.testCaseId || entry.id;
          let existingWinnerKey = null;
          if (tcKey && byKey.has(`key_${tcKey}`)) {
            existingWinnerKey = `key_${tcKey}`;
          } else if (tcId && byKey.has(`id_${tcId}`)) {
            existingWinnerKey = `id_${tcId}`;
          }

          if (!existingWinnerKey) {
            if (tcKey) byKey.set(`key_${tcKey}`, entry);
            if (tcId) byKey.set(`id_${tcId}`, entry);
          } else {
            const existing = byKey.get(existingWinnerKey);
            if (existing !== entry) {
              const existingWins = existing._hasExecution || (!entry._hasExecution && existing._createdAt >= entry._createdAt);
              const winner = existingWins ? existing : entry;
              const loser = existingWins ? entry : existing;
              if (tcKey) byKey.set(`key_${tcKey}`, winner);
              if (tcId) byKey.set(`id_${tcId}`, winner);

              // Silently unlink the duplicate blank run from the cycle in background
              const loserRunId = loser._runIssue?.id;
              if (loserRunId) {
                const loserProp = loser._runIssue?.properties?.['testpulse-run-data'] || {};
                const hasData = loser._hasExecution;
                if (!hasData) {
                  api.asUser().requestJira(route`/rest/api/3/issue/${loserRunId}`, { method: 'DELETE' }).catch(() => {});
                } else {
                  api.asUser().requestJira(route`/rest/api/3/issue/${loserRunId}/properties/testpulse-run-data`, {
                    method: 'PUT',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...loserProp, unlinkedFromCycle: true, unlinkedAt: Date.now() })
                  }).catch(() => {});
                }
              }
            }
          }
        }

        const uniqueEntries = Array.from(new Set(byKey.values()));
        const cleanEntries = uniqueEntries.map(entry => {
          const { _runIssue, _tcIdStr, _normStatus, _hasExecution, _createdAt, ...clean } = entry;
          return clean;
        });

        // Reconcile cycle sharded index in background so getTestCycles and Dashboard match live Jira runs
        writeCycleIndex(cycleId, cleanEntries.map(e => ({
          id: String(e.id),
          key: e.key,
          testCaseKey: e.testCaseKey || e.key,
          testRunId: e.testRunId,
          testRunKey: e.testRunKey,
          summary: e.summary,
          status: e.status,
          nativeStatus: e.nativeStatus || e.status,
          executionType: e.executionType || 'Manual',
          linkedBugs: e.linkedBugs || []
        }))).catch(() => {});

        return cleanEntries;
      }
    }

    // 2. Fallback strictly to cycle lightweight index (no exec_ property scanning)
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
      evidences: entry.evidences || [],
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
      evidences: entry.evidences || [],
      linkedBugs: entry.linkedBugs || [],
      lockedAt: entry.lockedAt || null,
      _detailLoaded: true
    }));
  }
};


const updateLightweightIndex = async (cycleId, updateFn) => {
    // readCycleIndex returns null (no index), [] (cleared), or [...entries]
    let lightWeight = await readCycleIndex(cycleId);
    lightWeight = updateFn(lightWeight ?? []); // null → [] for updateFn
    lightWeight = lightWeight.map(item => ({ ...item, linkedBugs: trimBugsForIndex(item.linkedBugs) }));
    await writeCycleIndex(cycleId, lightWeight);
};


resolver.define('getExecutionReport', async ({ payload }) => {
  const { projectId, config } = payload;
  const cycleType = config?.testCycleType || 'Test Cycle';
  
  const jql = `project = ${projectId} AND issuetype = "${cycleType}" ORDER BY created DESC`;
  let allIssues = [];
  let token = null;
  let isLast = false;
  while (!isLast) {
      const page = await fetchJqlPage(jql, ['summary', 'issuetype'], null, ['testops-plan-link'], token, 100);
      if (page.error) break;
      allIssues = allIssues.concat(page.issues);
      token = page.nextPageToken;
      isLast = page.isLast;
      if (!token) break;
  }
  
  const cycles = await processInBatches(allIssues, 5, 200, async (issue) => {
    const properties = issue.properties || {};
    const planId = properties['testops-plan-link']?.planId || null;
    let rawExecution = (await readCycleIndex(issue.id)) ?? [];
    
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

    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution
    };
  });



  
  // Fetch live bug details
  const allBugKeys = new Set();
  cycles.forEach(c => {
     c.execution?.forEach(ex => {
        ex.linkedBugs?.forEach(b => {
           if (b.key) allBugKeys.add(b.key);
        });
     });
  });

  const bugMap = {};
  if (allBugKeys.size > 0) {
    const sevField = 'customfield_10238';
    await processInBatches(Array.from(allBugKeys), 8, 100, async key => {
         try {
            const fieldsToFetch = ['summary', 'status', 'assignee', 'resolution', 'priority', 'created', 'issuetype', sevField].join(',');
            let resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?expand=changelog&fields=${fieldsToFetch}`);
            if (resp.status === 429) {
               await new Promise(r => setTimeout(r, 1200));
               resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?expand=changelog&fields=${fieldsToFetch}`);
            }
            if (resp.ok) {
               const i = await resp.json();
               
               // MX Holidays
               const mxHolidays = new Set([
                 '2024-01-01', '2024-02-05', '2024-03-18', '2024-05-01', '2024-09-16', '2024-10-01', '2024-11-18', '2024-12-25',
                 '2025-01-01', '2025-02-03', '2025-03-17', '2025-05-01', '2025-09-16', '2025-11-17', '2025-12-25',
                 '2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25',
                 '2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'
               ]);

               function getBusinessHours(startMs, endMs) {
                 if (!startMs || !endMs || startMs >= endMs) return 0;
                 let current = new Date(startMs);
                 const end = new Date(endMs);
                 let businessMinutes = 0;
                 const mxOffset = -6 * 60 * 60 * 1000; 

                 while (current < end) {
                    const mxTime = new Date(current.getTime() + mxOffset);
                    const day = mxTime.getUTCDay();
                    const hour = mxTime.getUTCHours();
                    const dateString = mxTime.toISOString().split('T')[0];
                    
                    let isBusiness = false;
                    if (!mxHolidays.has(dateString)) {
                        if (day >= 1 && day <= 4) { 
                            if (hour >= 7 && hour < 18) isBusiness = true;
                        } else if (day === 5) {
                            if (hour >= 7 && hour < 13) isBusiness = true;
                        }
                    }
                    if (isBusiness) businessMinutes++;
                    current.setTime(current.getTime() + 60000);
                 }
                 return businessMinutes / 60;
               }

               const timesSpent = {};
               let currentStatus = 'Nuevo'; // Default assumed start state
               let lastTime = new Date(i.fields.created).getTime();
               
               const histories = i.changelog?.histories || [];
               // Jira returns histories ascending by created, but double check
               histories.sort((a,b) => new Date(a.created).getTime() - new Date(b.created).getTime());

               histories.forEach(history => {
                  const statusItem = history.items.find(item => item.field === 'status');
                  if (statusItem) {
                     const transTime = new Date(history.created).getTime();
                     const hours = getBusinessHours(lastTime, transTime);
                     
                     // If fromString exists, prefer it. Otherwise use the tracked currentStatus.
                     const stateName = (statusItem.fromString || currentStatus).toLowerCase();
                     timesSpent[stateName] = (timesSpent[stateName] || 0) + hours;
                     
                     currentStatus = statusItem.toString;
                     lastTime = transTime;
                  }
               });
               
               // Add ongoing time if not closed
               const finalStatus = currentStatus.toLowerCase();
               const isClosed = ['cerrada', 'cerrado', 'done', 'resolved', 'resuelta', 'resuelto'].includes(finalStatus);
               if (!isClosed) {
                  const ongoingHours = getBusinessHours(lastTime, Date.now());
                  timesSpent[finalStatus] = (timesSpent[finalStatus] || 0) + ongoingHours;
               }

                // Extract *Severity strictly from customfield_10238 or any customfield holding severity
                let sevVal = 'Sin definir';
                if (i.fields?.[sevField]) {
                  const sf = i.fields[sevField];
                  sevVal = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
                } else if (i.fields) {
                  for (const [fKey, fVal] of Object.entries(i.fields)) {
                    if (fKey.startsWith('customfield_') && fVal) {
                      const vStr = typeof fVal === 'object' ? (fVal.value || fVal.name || '') : String(fVal);
                      if (['bloqueante', 'crítico', 'critico', 'mayor', 'menor', 'medio', 'media', 'blocker', 'critical', 'major', 'minor', 'medium', 'alta', 'high', 'low'].includes(String(vStr).toLowerCase())) {
                        sevVal = vStr;
                        break;
                      }
                    }
                  }
                }

                bugMap[key] = {
                  key,
                  summary: i.fields?.summary,
                  status: i.fields?.status?.name,
                  assignee: i.fields?.assignee?.displayName || 'Sin asignar',
                  resolution: i.fields?.resolution?.name || 'Unresolved',
                  priority: i.fields?.priority?.name || '',
                  issuetype: i.fields?.issuetype?.name || 'Bug',
                  severity: sevVal,
                  rawFields: i.fields,
                  timesSpent
                };
             }
          } catch (e) {
             console.error('Error fetching bug ' + key, e);
          }
     });

     cycles.forEach(c => {
       if (Array.isArray(c.execution)) c.execution.forEach(ex => {
          ex.linkedBugs?.forEach(b => {
             if (bugMap[b.key]) {
                Object.assign(b, bugMap[b.key]);
             }
          });
       });
     });
  }

  return { cycles, bugMap };
});

resolver.define('getBugsBatch', async ({ payload }) => {
  const { keys = [] } = payload;
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (uniqueKeys.length === 0) return {};
  const sevField = 'customfield_10238';
  const bugMap = {};
  await processInBatches(uniqueKeys, 8, 50, async key => {
    try {
      const fieldsToFetch = ['summary', 'status', 'assignee', 'resolution', 'priority', 'created', 'issuetype', sevField].join(',');
      let resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=${fieldsToFetch}`);
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1200));
        resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=${fieldsToFetch}`);
      }
      if (resp.ok) {
        const i = await resp.json();
        let sevVal = 'Sin definir';
        if (i.fields?.[sevField]) {
          const sf = i.fields[sevField];
          sevVal = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
        } else if (i.fields) {
          for (const [fKey, fVal] of Object.entries(i.fields)) {
            if (fKey.startsWith('customfield_') && fVal) {
              const vStr = typeof fVal === 'object' ? (fVal.value || fVal.name || '') : String(fVal);
              if (['bloqueante', 'crítico', 'critico', 'mayor', 'menor', 'medio', 'media', 'blocker', 'critical', 'major', 'minor', 'medium', 'alta', 'high', 'low'].includes(String(vStr).toLowerCase())) {
                sevVal = vStr;
                break;
              }
            }
          }
        }
        bugMap[key] = {
          key,
          summary: i.fields?.summary,
          status: i.fields?.status?.name,
          assignee: i.fields?.assignee?.displayName || 'Sin asignar',
          resolution: i.fields?.resolution?.name || 'Unresolved',
          priority: i.fields?.priority?.name || '',
          issuetype: i.fields?.issuetype?.name || 'Bug',
          severity: sevVal,
          rawFields: i.fields
        };
      }
    } catch (e) {
      console.error('[getBugsBatch] Error fetching bug ' + key, e);
    }
  });
  return bugMap;
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
      const runIssues = await fetchAllIssues(
        `issue in linkedIssues("${cycleId}")`,
        ['summary', 'status', 'assignee', 'attachment', 'description', 'issuelinks'],
        null,
        ['testpulse-run-data'],
        50
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
          evidences: dedupeEvidences([
            ...(runIssue.fields?.attachment || []).map(a => ({ id: String(a.id), filename: a.filename, url: a.content })),
            ...(prop.evidences || [])
          ]),
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
    // createTestRunsInJiraForCycle handles auto-recovery (finds existing runs) + creation in one query
    const CHUNK_SIZE = 10;
    const allCreatedRuns = [];
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
      const chunk = newTests.slice(i, i + CHUNK_SIZE);
      const created = await createTestRunsInJiraForCycle({
        projectId,
        cycleId,
        cycleKey,
        testCases: chunk,
        config
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

    return { success: true, addedTests: allCreatedRuns };
  }

  return { success: true, addedTests: [] };
});

resolver.define('syncCycleIndexWithRuns', async ({ payload }) => {
  const { cycleId, addedRuns } = payload;
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

  return { success: true, addedTests: createdRuns };
});

resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  await updateLightweightIndex(cycleId, (lw) => lw.filter(t => String(t.id) !== String(testId)));
  
  try {
    const jql = `issue in linkedIssues("${cycleId}") AND (issue in linkedIssues("${testId}") OR key = "${testId}" OR id = "${testId}") AND issuetype in ("Test Run", "TestRun", "Ejecución de prueba", "Ejecución")`;
    const runRes = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=id,status,attachment,issuelinks&properties=testpulse-run-data`);
    if (runRes.ok) {
      const runData = await runRes.json();
      const runs = runData.issues || [];
      for (const r of runs) {
        const prop = r.properties?.['testpulse-run-data'] || {};
        const normStatus = normalizeJiraStatus(r.fields?.status?.name || prop.status || 'Not Run');
        const isExecuted = normStatus !== 'Not Run' && normStatus !== 'To Do';
        const hasEvidences = (r.fields?.attachment && r.fields.attachment.length > 0) || (prop.evidences && prop.evidences.length > 0);
        const hasCommentsOrIterations = (prop.comment && prop.comment.trim().length > 0) || (prop.iterations && prop.iterations.length > 0) || prop.executedBy;

        if (isExecuted || hasEvidences || hasCommentsOrIterations) {
          // PRESERVE IN JIRA: Unlink from cycle and mark property for auto-recovery
          await unlinkIssueFromCycle(r.id, cycleId);
          await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}/properties/testpulse-run-data`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...prop,
              cycleId: String(cycleId),
              testCaseId: String(testId),
              unlinkedFromCycle: true,
              unlinkedAt: Date.now()
            })
          }).catch(() => {});
        } else {
          // Pristine / unexecuted: Delete issue to keep Jira clean
          await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}`, { method: 'DELETE' }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn(`[removeTestFromCycle] Error handling Test Run:`, e.message);
  }

  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`, { method: 'DELETE' }).catch(() => {});
  return { success: true };
});

resolver.define('removeManyTestsFromCycle', async ({ payload }) => {
  const { cycleId, testIds } = payload;
  if (!testIds || testIds.length === 0) return { success: true, removed: 0 };
  const ids = testIds.map(String);

  await updateLightweightIndex(cycleId, (lw) => lw.filter(t => !ids.includes(String(t.id))));

  if (ids.length <= 50) {
    await processInBatches(ids, 5, 150, async (testId) => {
      try {
        const jql = `issue in linkedIssues("${cycleId}") AND (issue in linkedIssues("${testId}") OR key = "${testId}" OR id = "${testId}") AND issuetype in ("Test Run", "TestRun", "Ejecución de prueba", "Ejecución")`;
        const runRes = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=id,status,attachment,issuelinks&properties=testpulse-run-data`);
        if (runRes.ok) {
          const runData = await runRes.json();
          for (const r of (runData.issues || [])) {
            const prop = r.properties?.['testpulse-run-data'] || {};
            const normStatus = normalizeJiraStatus(r.fields?.status?.name || prop.status || 'Not Run');
            const isExecuted = normStatus !== 'Not Run' && normStatus !== 'To Do';
            const hasEvidences = (r.fields?.attachment && r.fields.attachment.length > 0) || (prop.evidences && prop.evidences.length > 0);
            const hasCommentsOrIterations = (prop.comment && prop.comment.trim().length > 0) || (prop.iterations && prop.iterations.length > 0) || prop.executedBy;

            if (isExecuted || hasEvidences || hasCommentsOrIterations) {
              await unlinkIssueFromCycle(r.id, cycleId);
              await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}/properties/testpulse-run-data`, {
                method: 'PUT',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...prop,
                  cycleId: String(cycleId),
                  testCaseId: String(testId),
                  unlinkedFromCycle: true,
                  unlinkedAt: Date.now()
                })
              }).catch(() => {});
            } else {
              await api.asUser().requestJira(route`/rest/api/3/issue/${r.id}`, { method: 'DELETE' }).catch(() => {});
            }
          }
        }
      } catch (e) {}

      await api.asUser().requestJira(
        route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`,
        { method: 'DELETE' }
      ).catch(() => {});
      return true;
    });
  }

  return { success: true, removed: ids.length };
});



resolver.define('updateTestStatus', async ({ payload }) => {
  const { cycleId, testId, testRunId, status, comment, evidence, evidences, linkedBugs, steps, iterations, projectId, takeover } = payload;
  
  let userData = null;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (response.ok) {
      userData = await response.json();
    }
  } catch (e) {
    console.error('Error fetching myself data', e);
  }

  let isAdmin = false;
  if (projectId) {
    try {
      const permRes = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`);
      if (permRes.ok) {
        const permData = await permRes.json();
        isAdmin = permData.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
      }
    } catch (e) {
      console.error('Error checking admin permissions', e);
    }
  }

  let executorInfo = undefined;
  if ((status && status !== 'Not Run' && status !== 'To Do' && userData) || (takeover && userData)) {
    executorInfo = {
      accountId: userData.accountId,
      displayName: userData.displayName
    };
  }

  // Resolve target Test Run issue (native V2)
  let targetRunId = testRunId;
  if (!targetRunId) {
    try {
      const runIssues = await fetchAllIssues(
        `issue in linkedIssues("${cycleId}")`,
        ['summary', 'status', 'description', 'assignee', 'issuelinks'],
        null,
        ['testpulse-run-data'],
        50
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

  const TERMINAL = ['Pass', 'Passed', 'Fail', 'Failed', 'Blocked'];
  let updatedTest = null;

  if (targetRunId) {
    // Read directly from target Jira Test Run issue
    const runRes = await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}?properties=testpulse-run-data&fields=summary,status,assignee,attachment,description,issuelinks`);
    let runIssue = null;
    let currentProp = {};
    if (runRes.ok) {
      runIssue = await runRes.json();
      currentProp = runIssue.properties?.['testpulse-run-data'] || {};
    }

    const currentExecutedBy = currentProp.executedBy || (runIssue?.fields?.assignee ? { accountId: runIssue.fields.assignee.accountId, displayName: runIssue.fields.assignee.displayName } : null);
    if (!takeover && currentExecutedBy && userData && currentExecutedBy.accountId !== userData.accountId && !isAdmin) {
      throw new Error('Solo el usuario que ejecutó la prueba original o un administrador puede modificarla.');
    }

    const newStatus = status !== undefined ? status : (currentProp.status || normalizeJiraStatus(runIssue?.fields?.status?.name) || 'Not Run');
    const newComment = comment !== undefined ? comment : (currentProp.comment || '');
    
    const jiraAttachments = (runIssue?.fields?.attachment || []).map(a => ({
      id: String(a.id),
      filename: a.filename,
      url: a.content
    }));

    let newEvidences;
    if (evidences !== undefined) {
      newEvidences = dedupeEvidences(evidences);
    } else {
      newEvidences = dedupeEvidences([...(currentProp.evidences || []), ...jiraAttachments]);
    }
    if (evidence) {
      newEvidences = dedupeEvidences([...newEvidences, evidence]);
    }
    const newIterations = iterations !== undefined ? iterations : (currentProp.iterations || []);
    const newLinkedBugs = linkedBugs !== undefined ? linkedBugs : (currentProp.linkedBugs || []);
    const newExecutedBy = executorInfo !== undefined ? executorInfo : currentExecutedBy;
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

    // 1. Transition status in Jira
    if (status !== undefined) {
      await transitionJiraIssue(targetRunId, newStatus).catch(console.warn);
    }

    // 2. Assignee (Tester)
    if (newExecutedBy?.accountId) {
      await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}/assignee`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: newExecutedBy.accountId })
      }).catch(console.warn);
    }

    // 3. Execution comment in Jira
    if (newStatus !== 'Not Run' || newComment || (newIterations && newIterations.length > 0)) {
      const commentAdf = buildExecutionAdfComment({
        cycleKey: cycleId,
        testCaseKey: testId,
        status: newStatus,
        comment: newComment,
        iterations: newIterations,
        executedBy: newExecutedBy
      });
      await syncExecutionComment(targetRunId, commentAdf).catch(console.warn);
    }

    // 4. Update status labels in Jira
    try {
      const issueRes = await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}?fields=labels`);
      if (issueRes.ok) {
        const issueData = await issueRes.json();
        const existingLabels = issueData.fields?.labels || [];
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
        await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { labels: newLabels } })
        }).catch(console.warn);
      }
    } catch (e) {
      console.warn('[updateTestStatus] Labels sync error:', e.message);
    }

    // 5. Save testpulse-run-data property on the Test Run issue itself
    const newProp = {
      ...currentProp,
      status: newStatus,
      comment: newComment,
      iterations: newIterations,
      executedBy: newExecutedBy,
      executedAt: Date.now(),
      evidences: newEvidences,
      linkedBugs: newLinkedBugs,
      lockedAt: newLockedAt
    };
    await api.asUser().requestJira(route`/rest/api/3/issue/${targetRunId}/properties/testpulse-run-data`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newProp)
    }).catch(console.warn);

    // 6. Update lightweight index on Cycle
    await updateLightweightIndex(cycleId, (lw) => {
      const item = lw.find(l => String(l.id) === String(testId) || String(l.testRunId) === String(targetRunId));
      if (item) {
        item.status = newStatus;
        item.linkedBugs = trimBugsForIndex(newLinkedBugs);
        item.executedBy = newExecutedBy;
        if (newLockedAt) item.lockedAt = newLockedAt;
      }
      return lw;
    });

    // 7. Delete any residual legacy exec_ property on the cycle issue to eliminate ghost states
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`, {
      method: 'DELETE'
    }).catch(() => {});

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
        const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testId}?fields=summary,issuetype,customfield_10534`);
        let tcSummary = String(testId);
        if (tcRes.ok) {
          const tcIssue = await tcRes.json();
          tcSummary = tcIssue.fields?.summary || String(testId);
        }
        const runPayload = {
          fields: {
            summary: `[Run] ${testId}: ${tcSummary}`.substring(0, 255),
            project: { key: projectKey || cycleIssue.fields?.project?.key },
            issuetype: { name: 'Test Run' },
            description: ensureValidAdf(null, `Test Run execution for test case ${testId}`)
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
          // Save run data
          const runDataProp = {
            cycleId: String(cycleId),
            testCaseId: String(testId),
            status: newStatus,
            comment: comment || '',
            iterations: iterations || [],
            evidences: evidences || [],
            linkedBugs: linkedBugs || [],
            executedBy: executorInfo || null,
            executedAt: Date.now(),
            lockedAt: newLockedAt
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

    updatedTest = {
      id: String(testId),
      testRunId: createdRunId,
      testRunKey: createdRunKey,
      status: newStatus,
      comment: comment || '',
      evidences: evidences || [],
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

  return { success: true, lockedAt: updatedTest?.lockedAt || null, test: updatedTest };
});


resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId } = payload;
  return await getCycleExecutionSummary(cycleId);
});

// Creates a Jira Issue Link between the test case and a bug
resolver.define('linkBugToTest', async ({ payload }) => {
  const { testCaseId, bugKey, bugId } = payload;
  
  try {
    const outwardIssue = bugKey ? { key: bugKey } : { id: String(bugId) };
    const response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: 'Blocks' },
        inwardIssue: { id: String(testCaseId) },
        outwardIssue
      })
    });
    const ok = response.status === 201 || response.status === 200;
    if (!ok) {
      const body = await response.text();
      console.error('linkBugToTest failed:', response.status, body);
    }
    return { success: ok };
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

// === Bulk Upload: Field Mapping Config ===
resolver.define('getBulkMapping', async () => {
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/user/properties/testops-bulk-mapping`);
    if (response.status === 404) return { mapping: {}, folderId: '' };
    if (!response.ok) {
      console.warn('getBulkMapping response not ok:', response.status);
      return { mapping: {}, folderId: '' };
    }
    const data = await response.json();
    return data.value || { mapping: {}, folderId: '' };
  } catch (e) {
    console.error('getBulkMapping error:', e);
    return { mapping: {}, folderId: '' };
  }
});

resolver.define('saveBulkMapping', async ({ payload }) => {
  const { mapping, folderId } = payload;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/user/properties/testops-bulk-mapping`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapping: mapping || {}, folderId: folderId || '' })
    });
    if (!response.ok) {
      console.error('saveBulkMapping failed:', await response.text());
      return { success: false, message: 'Fallo al guardar en Jira' };
    }
    return { success: true };
  } catch (e) {
    console.error('saveBulkMapping error:', e);
    return { success: false, message: String(e) };
  }
});

// === Bulk Upload: Link issues to folder in batch ===
resolver.define('bulkLinkToFolder', async ({ payload }) => {
  const { issueIds, folderId } = payload;
  if (!folderId || !issueIds || issueIds.length === 0) return { success: true, count: 0 };

  const results = await Promise.allSettled(
    issueIds.map(id =>
      api.asUser().requestJira(route`/rest/api/3/issue/${id}/properties/testops-folder-link`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId })
      })
    )
  );
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  return { success: true, count: succeeded };
});

resolver.define('getAllowedProjects', async () => {
  try {
    let response = await api.asUser().requestJira(route`/rest/api/3/project`);
    let data = await response.json();
    let projects = Array.isArray(data) ? data : (data.values || []);

    if (projects.length === 0) {
      response = await api.asApp().requestJira(route`/rest/api/3/project`);
      data = await response.json();
      projects = Array.isArray(data) ? data : (data.values || []);
    }
    
    return projects.map(p => ({ id: p.id, key: p.key, name: p.name }));
  } catch (err) {
    console.error("getAllowedProjects exception:", err);
    return [];
  }
});

resolver.define('setAllowedProjects', async ({ payload }) => {
  // Ahora seteamos la propiedad del proyecto individualmente
  const { projectId, enabled } = payload;
  await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-enabled`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(enabled)
  });
  return { success: true };
});

resolver.define('isProjectAllowed', async ({ payload, context }) => {
  try {
    const projectId = payload?.projectId || context?.extension?.project?.id;
    if (!projectId) return { allowed: true };
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testpulse-enabled`);
    if (response.status === 404) return { allowed: true };
    if (!response.ok) return { allowed: true };
    const data = await response.json();
    return { allowed: data.value?.enabled !== false };
  } catch (err) {
    return { allowed: true };
  }
});

resolver.define('uploadAttachment', async ({ payload }) => {
  const { issueId, filename, base64Data, mimeType } = payload;
  if (!issueId || !base64Data) {
    throw new Error("Missing issueId or base64Data");
  }

  try {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    
    const formData = new FormData();
    formData.append('file', blob, filename || `attachment_${Date.now()}.png`);

    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/attachments`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[uploadAttachment] Failed for issue ${issueId}: ${response.status} ${errText}`);
      throw new Error(`Jira upload error ${response.status}: ${errText}`);
    }

    const attachments = await response.json();
    return attachments;
  } catch (err) {
    console.error(`[uploadAttachment] Exception:`, err.message);
    throw err;
  }
});

resolver.define('deleteAttachment', async ({ payload }) => {
  const { attachmentId } = payload;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/attachment/${attachmentId}`, {
      method: 'DELETE'
    });
    return { success: response.status === 204 || response.status === 200 };
  } catch (e) {
    console.error('deleteAttachment error:', e);
    return { success: false, error: e.message };
  }
});

resolver.define('getAttachmentContent', async ({ payload }) => {
  const { attachmentId } = payload;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${attachmentId}`);
    if (response.status !== 200) {
      throw new Error(`Failed to fetch attachment content, status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return { base64: buffer.toString('base64'), mimeType: response.headers.get('content-type') };
  } catch (e) {
    console.error('getAttachmentContent error:', e);
    return { error: e.message };
  }
});

// === SLA & Business Hours Helpers ===
function getEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function getNthDayOfMonth(year, month, dayOfWeek, n) {
  let d = new Date(year, month, 1);
  let count = 0;
  while (d.getMonth() === month) {
    if (d.getDay() === dayOfWeek) {
      count++;
      if (count === n) return d.getDate();
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function isHoliday(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const day = date.getDate();
  
  // Fijos Oficiales + Navidad/Fin de año
  if (month === 0 && day === 1) return true; // 1 Ene
  if (month === 4 && day === 1) return true; // 1 May
  if (month === 8 && day === 16) return true; // 16 Sep
  if (month === 11 && day === 24) return true; // 24 Dic
  if (month === 11 && day === 25) return true; // 25 Dic
  if (month === 11 && day === 31) return true; // 31 Dic
  
  // Móviles
  if (month === 1 && day === getNthDayOfMonth(year, 1, 1, 1)) return true; // 1er Lunes Feb (5 Feb)
  if (month === 2 && day === getNthDayOfMonth(year, 2, 1, 3)) return true; // 3er Lunes Mar (21 Mar)
  if (month === 10 && day === getNthDayOfMonth(year, 10, 1, 3)) return true; // 3er Lunes Nov (20 Nov)
  
  // Jueves y Viernes Santo (Liverpool)
  const easter = getEaster(year);
  const juevesSanto = new Date(easter); juevesSanto.setDate(juevesSanto.getDate() - 3);
  const viernesSanto = new Date(easter); viernesSanto.setDate(viernesSanto.getDate() - 2);
  
  if (month === juevesSanto.getMonth() && day === juevesSanto.getDate()) return true;
  if (month === viernesSanto.getMonth() && day === viernesSanto.getDate()) return true;
  
  return false;
}

function getBusinessMilliseconds(startMs, endMs) {
  if (!startMs || !endMs || startMs >= endMs) return 0;
  
  // Assume server time / issue time is mostly UTC or close to it,
  // we adjust by treating the epoch as Mexico City time (UTC-6)
  const tzOffsetMs = 6 * 60 * 60 * 1000; 
  
  const start = new Date(startMs - tzOffsetMs);
  const end = new Date(endMs - tzOffsetMs);
  
  let current = new Date(start.getTime());
  let totalMs = 0;
  
  while (current < end) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const date = current.getUTCDate();
    const dayOfWeek = current.getUTCDay(); // 0=Sun, 1=Mon...
    
    let nextDay = new Date(Date.UTC(year, month, date + 1, 0, 0, 0));
    let stepEnd = end < nextDay ? end : nextDay;
    
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not weekend
      const localSimDate = new Date(year, month, date);
      if (!isHoliday(localSimDate)) {
        const startHour = 7;
        const endHour = dayOfWeek === 5 ? 13 : 18; // Vie = 13:00, L-J = 18:00
        
        const workStart = new Date(Date.UTC(year, month, date, startHour, 0, 0));
        const workEnd = new Date(Date.UTC(year, month, date, endHour, 0, 0));
        
        const overlapStart = current > workStart ? current : workStart;
        const overlapEnd = stepEnd < workEnd ? stepEnd : workEnd;
        
        if (overlapStart < overlapEnd) {
          totalMs += (overlapEnd - overlapStart);
        }
      }
    }
    current = nextDay;
  }
  
  return totalMs;
}

// === Bug Resolution Time ===
resolver.define('getBugsResolutionTime', async ({ payload }) => {
  const { bugKeys } = payload;
  if (!bugKeys || !Array.isArray(bugKeys) || bugKeys.length === 0) {
    return {
      nuevoAnalisis: 0,
      analisisCurso: 0,
      cursoResuelta: 0,
      resueltaCerrada: 0,
      averageHours: 0
    };
  }
  
  let sumNuevoAnalisis = 0, cntNuevoAnalisis = 0;
  let sumAnalisisCurso = 0, cntAnalisisCurso = 0;
  let sumCursoResuelta = 0, cntCursoResuelta = 0;
  let sumResueltaCerrada = 0, cntResueltaCerrada = 0;
  
  let totalHours = 0;
  let countTotal = 0;
  let bugsReopened = 0;

  try {
    const jql = `key in (${bugKeys.join(',')})`;
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        expand: ['changelog'],
        fields: ['created'],
        maxResults: 100
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      for (const issue of (data.issues || [])) {
        const changelog = issue.changelog?.histories || [];
        const createdTime = new Date(issue.fields?.created || Date.now()).getTime();
        
        let times = { atencion: null, resuelta: null, cerrada: null };
        let isReopened = false;
        
        for (const history of changelog) {
          const statusItem = history.items.find(item => item.field === 'status');
          if (statusItem) {
            const toString = (statusItem.toString || '').toLowerCase();
            const fromString = (statusItem.fromString || '').toLowerCase();
            const time = new Date(history.created).getTime();
            
            const isTerminal = (str) => str.includes('cerrada') || str.includes('closed') || str.includes('resuelta') || str.includes('resolved') || str.includes('done');
            if (isTerminal(fromString) && !isTerminal(toString)) {
              isReopened = true;
            }
            
            if (toString.includes('analisis') || toString.includes('análisis') || toString.includes('curso') || toString === 'in progress' || toString.includes('revis') || toString.includes('review')) {
              if (!times.atencion || time < times.atencion) times.atencion = time;
            } else if (toString.includes('resuelta') || toString === 'resolved' || toString === 'done' || toString.includes('listo')) {
              if (!times.resuelta || time < times.resuelta) times.resuelta = time;
            } else if (toString.includes('cerrada') || toString === 'closed' || toString.includes('aceptado')) {
              if (!times.cerrada || time < times.cerrada) times.cerrada = time;
            }
          }
        }
        
        // Diffs in ms using Business Hours
        if (times.atencion) {
          sumNuevoAnalisis += getBusinessMilliseconds(createdTime, times.atencion);
          cntNuevoAnalisis++;
        } else if (times.resuelta) {
          sumNuevoAnalisis += getBusinessMilliseconds(createdTime, times.resuelta);
          cntNuevoAnalisis++;
        }
        
        if (times.atencion && times.resuelta && times.resuelta > times.atencion) {
          sumAnalisisCurso += getBusinessMilliseconds(times.atencion, times.resuelta);
          cntAnalisisCurso++;
        }
        
        if (times.resuelta && times.cerrada && times.cerrada > times.resuelta) {
          sumCursoResuelta += getBusinessMilliseconds(times.resuelta, times.cerrada);
          cntCursoResuelta++;
        }
        
        // Total (legacy or simple overall: Nuevo -> Resuelta/Cerrada)
        if (isReopened) {
          bugsReopened++;
        }

        const finalTime = times.cerrada || times.resuelta;
        if (finalTime && finalTime > createdTime) {
          totalHours += getBusinessMilliseconds(createdTime, finalTime) / (1000 * 60 * 60);
          countTotal++;
        }
      }
    }
  } catch (e) {
    console.log(`Failed to fetch bulk changelog`, e);
  }
  
  const toHours = (sum, cnt) => cnt > 0 ? (sum / cnt) / (1000 * 60 * 60) : 0;

  return {
    nuevoAnalisis: toHours(sumNuevoAnalisis, cntNuevoAnalisis),
    analisisCurso: toHours(sumAnalisisCurso, cntAnalisisCurso),
    cursoResuelta: toHours(sumCursoResuelta, cntCursoResuelta),
    resueltaCerrada: toHours(sumResueltaCerrada, cntResueltaCerrada),
    averageHours: countTotal > 0 ? (totalHours / countTotal) : 0,
    reopenedCount: bugsReopened
  };
});

resolver.define('getBugDetailsBatch', async ({ payload }) => {
  const { bugKeys } = payload;
  if (!bugKeys || bugKeys.length === 0) return [];
  
  try {
    const jql = `key in (${bugKeys.join(',')})`;
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        fields: ['summary', 'priority', 'status', 'assignee', 'resolution']
      })
    });
    
    if (!response.ok) {
       console.error("Error fetching bugs", await response.text());
       return [];
    }
    
    const data = await response.json();
    return (data.issues || []).map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      priority: issue.fields.priority?.name || 'N/A',
      status: issue.fields.status?.name || 'N/A',
      assignee: issue.fields.assignee?.displayName || 'Unassigned',
      resolution: issue.fields.resolution?.name || 'Unresolved'
    }));
  } catch (e) {
    console.error("Exception fetching bugs", e);
    return [];
  }
});


resolver.define('getTestCaseHistory', async ({ payload }) => {
  try {
    const { testId, projectId, config } = payload;
    if (!testId) return [];

    let tcId = String(testId);
    let tcKey = '';
    let targetProjectId = projectId;

    try {
      const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testId}?fields=key,summary,project,issuelinks`);
      if (tcRes.ok) {
        const tcData = await tcRes.json();
        tcId = String(tcData.id);
        tcKey = tcData.key;
        if (!targetProjectId) {
          targetProjectId = tcData.fields?.project?.id || tcData.fields?.project?.key;
        }
      }
    } catch (e) {
      console.warn('[getTestCaseHistory] Could not fetch tc issue:', e.message);
    }

    const historyMap = new Map(); // key -> historyItem

    // 1. Search Test Runs via JQL
    try {
      const searchClauses = [];
      if (tcKey) {
        searchClauses.push(`summary ~ "\"[Run] ${tcKey}:*\""`);
        searchClauses.push(`issue in linkedIssues("${tcKey}")`);
      }
      if (tcId) {
        searchClauses.push(`issue in linkedIssues("${tcId}")`);
      }

      const projectFilter = targetProjectId ? `project = "${targetProjectId}" AND ` : '';
      const runTypes = config?.testRunType ? `"${config.testRunType}", ` : '';
      const jql = `${projectFilter}(${searchClauses.join(' OR ')}) AND (issuetype in (${runTypes}"Test Run", "TestRun", "Ejecución de prueba", "Ejecución", "Test Execution") OR summary ~ "[Run]*") ORDER BY created DESC`;

      const runRes = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&properties=testpulse-run-data&fields=summary,status,assignee,issuelinks,created&maxResults=50`);
      if (runRes.ok) {
        const runData = await runRes.json();
        for (const run of (runData.issues || [])) {
          const prop = run.properties?.['testpulse-run-data'] || {};
          const isThisTc = String(prop.testCaseId) === tcId || 
                           (tcKey && prop.testCaseKey === tcKey) || 
                           (tcKey && run.fields?.summary?.includes(`[Run] ${tcKey}:`)) ||
                           (run.fields?.issuelinks || []).some(l => {
                             const other = l.outwardIssue || l.inwardIssue;
                             return other && (String(other.id) === tcId || (tcKey && other.key === tcKey));
                           });

          if (!isThisTc && (prop.testCaseId || prop.testCaseKey)) {
            continue;
          }

          let cycleId = prop.cycleId ? String(prop.cycleId) : '';
          let cycleKey = prop.cycleKey || '';
          let cycleSummary = '';

          const linkedCycle = (run.fields?.issuelinks || [])
            .map(l => l.outwardIssue || l.inwardIssue)
            .filter(Boolean)
            .find(i => String(i.id) !== tcId && (!tcKey || i.key !== tcKey));

          if (linkedCycle) {
            if (!cycleId) cycleId = String(linkedCycle.id);
            if (!cycleKey) cycleKey = linkedCycle.key;
            if (linkedCycle.fields?.summary) cycleSummary = linkedCycle.fields.summary;
          }

          const mapKey = cycleId || run.key;
          historyMap.set(mapKey, {
            cycleId: cycleId || run.id,
            cycleKey: cycleKey || (cycleId ? `Cycle #${cycleId}` : run.key),
            cycleSummary: cycleSummary || '',
            testRunKey: run.key,
            testRunId: run.id,
            status: normalizeJiraStatus(run.fields?.status?.name || prop.status || 'Not Run'),
            executedBy: prop.executedBy || (run.fields?.assignee ? { displayName: run.fields.assignee.displayName, accountId: run.fields.assignee.accountId } : null),
            iterations: prop.iterations || [],
            comment: prop.comment || '',
            executedAt: prop.executedAt || run.fields?.created
          });
        }
      }
    } catch (errSearch) {
      console.warn('[getTestCaseHistory] JQL search error:', errSearch.message);
    }

    // 2. Scan cycles via lightweight index for missing cycles / cycle summaries
    try {
      const cycleType = config?.testCycleType || 'Test Cycle';
      const projectJql = targetProjectId ? `project = "${targetProjectId}" AND ` : '';
      const cycleJql = `${projectJql}(issuetype in ("${cycleType}", "Test Cycle", "Ciclo de prueba") OR summary ~ "Ciclo*" OR summary ~ "Cycle*") ORDER BY created DESC`;
      
      const cycleRes = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${encodeURIComponent(cycleJql)}&fields=summary,key,id&maxResults=50`);
      if (cycleRes.ok) {
        const cycleData = await cycleRes.json();
        const cycles = cycleData.issues || [];

        for (const cycle of cycles) {
          const cycleIdStr = String(cycle.id);
          const entries = (await readCycleIndex(cycle.id)) || [];
          const match = entries.find(e => String(e.id) === tcId || (tcKey && (e.key === tcKey || e.testCaseKey === tcKey)));

          if (match) {
            const existing = historyMap.get(cycleIdStr);
            if (existing) {
              if (!existing.cycleSummary) existing.cycleSummary = cycle.fields.summary;
              if (!existing.cycleKey) existing.cycleKey = cycle.key;
            } else {
              historyMap.set(cycleIdStr, {
                cycleId: cycle.id,
                cycleKey: cycle.key,
                cycleSummary: cycle.fields.summary || '',
                testRunKey: match.testRunKey || '',
                testRunId: match.testRunId || '',
                status: normalizeJiraStatus(match.status || 'Not Run'),
                executedBy: match.executedBy || null,
                iterations: match.iterations || [],
                comment: match.comment || '',
                executedAt: match.executedAt || null
              });
            }
          } else {
            const existing = historyMap.get(cycleIdStr);
            if (existing && !existing.cycleSummary) {
              existing.cycleSummary = cycle.fields.summary;
              if (!existing.cycleKey) existing.cycleKey = cycle.key;
            }
          }
        }
      }
    } catch (errCycles) {
      console.warn('[getTestCaseHistory] Cycle scan error:', errCycles.message);
    }

    const historyList = Array.from(historyMap.values());
    return historyList;
  } catch (e) {
    console.error("getTestCaseHistory error:", e);
    return [];
  }
});


resolver.define('getIssueDescription', async ({ payload }) => {
  try {
    const { issueId } = payload;
    if (!issueId) return null;

    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=description,summary,issuelinks&properties=testpulse-run-data&expand=renderedFields`);
    if (!response.ok) return null;
    const data = await response.json();
    
    let desc = data.renderedFields?.description || data.fields?.description || null;
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
        const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${parentTcKeyOrId}?fields=description&expand=renderedFields`);
        if (tcRes.ok) {
          const tcData = await tcRes.json();
          return tcData.renderedFields?.description || tcData.fields?.description || desc;
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
  const jql = `issue in linkedIssues("${cycleId}")`;
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
  const jql = `project = ${projectId} AND issuetype = "${cycleType}" ORDER BY created DESC`;

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
  const { projectId, projectKey, linkedBugKeys = [], bugIssueTypes = [] } = payload;

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
    projectJql = `project = "${effectiveProject}" AND `;
  }

  let typeClause = '';
  if (typeIds.length > 0) {
    typeClause = `issuetype in (${typeIds.join(',')})`;
  } else {
    // Fallback to all standard bug names if typeIds couldn't be resolved
    const fallbackTypes = ['Error', 'Bug', 'Defect', 'Defecto', 'Falla', 'Incident', 'Incidente', 'Problema', 'Problem'];
    typeClause = `issuetype in (${fallbackTypes.map(t => `"${t}"`).join(',')})`;
  }

  const jql = `${projectJql}${typeClause} ORDER BY created DESC`;
  console.log(`[getProjectUnlinkedBugs] Running JQL query: ${jql}`);
  const fields = ['summary', 'status', 'assignee', 'priority', 'resolution', 'created', 'reporter', 'issuetype', 'project', 'customfield_10238', 'issuelinks'];

  let allIssues = [];
  let token = null;
  let isLast = false;
  let pages = 0;

  try {
    while (!isLast && pages < 10) {
      const page = await fetchJqlPage(jql, fields, null, null, token, 100);
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

  // Return ALL bugs with explicit issuelinks detection
  return allIssues.map(issue => {
    let sev = 'Sin definir';
    if (issue.fields?.customfield_10238) {
      const sf = issue.fields.customfield_10238;
      sev = typeof sf === 'object' ? (sf.value || sf.name || sf.label || String(sf)) : String(sf);
    }

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
      issuetype: issue.fields?.issuetype?.name || 'Bug',
      project: issue.fields?.project?.key || '',
      isLinked: isLinkedToTest,
      linkedTests: linkedTests
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
      const errText = await transRes.text();
      console.warn(`[transitionJiraIssue] Transition failed for ${issueIdOrKey}: ${transRes.status} ${errText}`);
      return { success: false, error: errText };
    }

    return { success: true, transitionId: matched.id, toStatus: matched.to?.name };
  } catch (e) {
    console.error(`[transitionJiraIssue] Exception for ${issueIdOrKey}:`, e);
    return { success: false, error: e.message };
  }
}

// Helper: Creates an Issue Link between two Jira issues
async function linkTwoIssues(inwardIdOrKey, outwardIdOrKey, linkTypeName = 'Relates') {
  try {
    const inwardIssue = String(inwardIdOrKey).includes('-') ? { key: String(inwardIdOrKey) } : { id: String(inwardIdOrKey) };
    const outwardIssue = String(outwardIdOrKey).includes('-') ? { key: String(outwardIdOrKey) } : { id: String(outwardIdOrKey) };
    
    const res = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: linkTypeName },
        inwardIssue,
        outwardIssue
      })
    });
    return res.ok || res.status === 201 || res.status === 200;
  } catch (e) {
    console.warn(`[linkTwoIssues] Error linking ${inwardIdOrKey} -> ${outwardIdOrKey}:`, e.message);
    return false;
  }
}

// Resolver: Creates Test Run Jira Issues in bulk for a cycle
resolver.define('createTestRunsForCycle', async ({ payload }) => {
  const { projectId, cycleId, cycleKey, testCases, config } = payload;
  const testRunType = config?.testRunType || 'Test Run';

  if (!testCases || testCases.length === 0) return { created: [], count: 0 };

  const issuesToCreate = testCases.map(tc => ({
    fields: {
      project: { id: String(projectId) },
      summary: `[Run] ${tc.key || tc.id}: ${tc.summary || 'Test Case'}`,
      issuetype: { name: testRunType },
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Ejecución de prueba de Test Pulse para el caso ${tc.key || tc.id} en el ciclo ${cycleKey || cycleId}.` }]
          }
        ]
      }
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
    const jql = `issue in linkedIssues("${cycleId}") AND issuetype = "${testRunType}" ORDER BY key ASC`;
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
        evidences: issue.fields.attachment || runData.evidences || [],
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
resolver.define('updateTestRunExecution', async ({ payload }) => {
  const { testRunId, status, iterations, comment, evidences, linkedBugs, projectId, takeover } = payload;

  let userData = null;
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (response.ok) userData = await response.json();
  } catch (e) {
    console.warn('Error fetching myself data:', e);
  }

  // 1. Fetch current run property
  let currentRunData = {};
  try {
    const propRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/properties/testpulse-run-data`);
    if (propRes.ok) {
      const propJson = await propRes.json();
      currentRunData = propJson.value || {};
    }
  } catch (e) {}

  let executorInfo = currentRunData.executedBy;
  if ((status && status !== 'Not Run' && userData) || (takeover && userData)) {
    executorInfo = {
      accountId: userData.accountId,
      displayName: userData.displayName
    };
  }

  const updatedRunData = {
    ...currentRunData,
    status: status !== undefined ? status : currentRunData.status,
    iterations: iterations !== undefined ? iterations : (currentRunData.iterations || []),
    comment: comment !== undefined ? comment : (currentRunData.comment || ''),
    evidences: evidences !== undefined ? evidences : (currentRunData.evidences || []),
    linkedBugs: linkedBugs !== undefined ? linkedBugs : (currentRunData.linkedBugs || []),
    executedBy: executorInfo,
    executedAt: status && status !== 'Not Run' ? (currentRunData.executedAt || Date.now()) : currentRunData.executedAt
  };

  // 2. Save property on Test Run issue
  await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/properties/testpulse-run-data`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedRunData)
  });

  // 3. Transition Jira Status if status was updated
  if (status) {
    await transitionJiraIssue(testRunId, status);
  }

  // 4. Update Assignee to tester
  if (executorInfo?.accountId) {
    await api.asUser().requestJira(route`/rest/api/3/issue/${testRunId}/assignee`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: executorInfo.accountId })
    }).catch(console.warn);
  }

  // 5. Post or update execution comment on Jira Issue
  if (updatedRunData.status !== 'Not Run' || updatedRunData.comment || (updatedRunData.iterations && updatedRunData.iterations.length > 0)) {
    const commentAdf = buildExecutionAdfComment({
      cycleKey: updatedRunData.cycleKey,
      testCaseKey: updatedRunData.testCaseKey,
      status: updatedRunData.status,
      comment: updatedRunData.comment,
      iterations: updatedRunData.iterations,
      executedBy: updatedRunData.executedBy
    });
    await syncExecutionComment(testRunId, commentAdf);
  }

  return { success: true, updated: updatedRunData };
});

// Resolver: Single Cycle Pilot Migration (V1 -> V2)



const getTestCaseSnapshot = async (testCaseIdOrKey) => {
  if (!testCaseIdOrKey) return null;
  try {
    const tcRes = await api.asUser().requestJira(route`/rest/api/3/issue/${testCaseIdOrKey}?fields=description,summary,issuetype,project,customfield_10534,customfield_10530,customfield_10535&expand=renderedFields`);
    if (tcRes.ok) {
      const tcData = await tcRes.json();
      let executionType = 'Manual';
      if (tcData.fields?.customfield_10534) {
        const v = tcData.fields.customfield_10534;
        if (Array.isArray(v) && v.length > 0) executionType = v[0].value || v[0].name || String(v[0]);
        else if (typeof v === 'object' && v !== null) executionType = v.value || v.name || '';
        else executionType = String(v);
      } else if (tcData.fields?.customfield_10530) {
        const v = tcData.fields.customfield_10530;
        if (Array.isArray(v) && v.length > 0) executionType = v[0].value || v[0].name || String(v[0]);
        else if (typeof v === 'object' && v !== null) executionType = v.value || v.name || '';
        else executionType = String(v);
      }
      return {
        id: tcData.id,
        key: tcData.key,
        projectId: tcData.fields?.project?.id,
        summary: tcData.fields?.summary || '',
        description: ensureValidAdf(tcData.fields?.description, tcData.fields?.summary),
        renderedDescription: tcData.renderedFields?.description || null,
        executionType: executionType || 'Manual',
        rawFields: tcData.fields || {}
      };
    }
  } catch (e) {
    console.warn(`[getTestCaseSnapshot] Error for ${testCaseIdOrKey}:`, e.message);
  }
  return null;
};

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
      const errText = await res.text();
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
    const jql = `project = ${projectId} AND issuetype = "${cycleType}" ORDER BY created DESC`;
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

resolver.define('getReportAutomationConfig', async ({ payload, context }) => {
  try {
    const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
    if (!projectId) return { success: false, error: 'ProjectId es requerido' };
    
    const config = await getAppStorage(`report_automation_config_${projectId}`);
    const lastDispatch = await getAppStorage(`report_automation_last_dispatch_${projectId}`);
    
    return {
      success: true,
      config: config || {
        enabled: false,
        webhookUrl: '',
        recipients: '',
        frequency: 'weekdays', // 'daily', 'weekdays', 'weekly'
        weeklyDay: '5', // 5 = Friday
        hour: '18', // 18:00
        minute: '00',
        timezone: 'America/Mexico_City',
        scopePlan: 'all', // 'all', 'latest', or specific planId
        scopeCycle: 'all', // 'all', 'latest', or specific cycleId
        sendOnCycleCompleted: false
      },
      lastDispatch: lastDispatch || null
    };
  } catch (err) {
    console.error('[getReportAutomationConfig] Error:', err);
    return { success: false, error: err.message };
  }
});

resolver.define('saveReportAutomationConfig', async ({ payload, context }) => {
  try {
    const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
    const config = payload?.config;
    if (!projectId) return { success: false, error: 'ProjectId es requerido' };
    if (!config) return { success: false, error: 'Configuración es requerida' };

    await setAppStorage(`report_automation_config_${projectId}`, config);

    // Update active projects registry
    let activeProjects = (await getAppStorage('report_automation_active_projects')) || [];
    if (!Array.isArray(activeProjects)) activeProjects = [];
    
    if (config.enabled && !activeProjects.includes(projectId)) {
      activeProjects.push(projectId);
      await setAppStorage('report_automation_active_projects', activeProjects);
    } else if (!config.enabled && activeProjects.includes(projectId)) {
      activeProjects = activeProjects.filter(id => String(id) !== String(projectId));
      await setAppStorage('report_automation_active_projects', activeProjects);
    }

    return { success: true, config };
  } catch (err) {
    console.error('[saveReportAutomationConfig] Error:', err);
    return { success: false, error: err.message };
  }
});

resolver.define('triggerManualReportDispatch', async ({ payload, context }) => {
  try {
    const projectId = String(payload?.projectId || context?.extension?.project?.id || '');
    const webhookUrl = payload?.webhookUrl;
    const reportData = payload?.reportData;

    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return { success: false, error: 'URL de Webhook inválida o no especificada' };
    }

    let activeReportData = reportData;
    if (!activeReportData || !activeReportData.htmlReport) {
      const projName = activeReportData?.projectName || 'Proyecto Jira';
      const nowFormatted = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      const testHtml = `
        <div style="max-width: 700px; margin: 0 auto; font-family: sans-serif; border: 1px solid #DFE1E6; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #E1007A 0%, #002D62 100%); color: #fff; padding: 18px 24px;">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #FFE0F0;">TEST PULSE SUITE • PRUEBA DE CONEXIÓN</div>
            <h2 style="margin: 4px 0 0 0; font-size: 20px; color: #ffffff;">Reporte Ejecutivo (Prueba)</h2>
          </div>
          <div style="padding: 20px 24px; color: #172B4D;">
            <p>Este es un correo de prueba de <strong>Test Pulse Suite</strong> enviado mediante <strong>Jira Automation</strong>.</p>
            <p><strong>Proyecto:</strong> ${projName}</p>
            <p><strong>Fecha y Hora:</strong> ${nowFormatted} (CDMX)</p>
            <div style="background: #E3FCEF; border: 1px solid #ABF5D1; color: #006644; padding: 12px 16px; border-radius: 6px; font-weight: 600; margin-top: 14px;">
              🟢 La integración con el webhook entrante de Jira Automation está operando correctamente.
            </div>
          </div>
        </div>
      `;
      activeReportData = {
        projectName: projName,
        projectKey: activeReportData?.projectKey || '',
        recipients: activeReportData?.recipients || '',
        emailSubject: `[Prueba de Conexión] Test Pulse Suite - ${projName} (${nowFormatted})`,
        htmlReport: testHtml,
        plainText: `Test Pulse Suite - Prueba de Conexión para ${projName} (${nowFormatted})`,
        summary: { type: 'TEST_DISPATCH' },
        stats: {}
      };
    }

    const bodyPayload = {
      timestamp: new Date().toISOString(),
      source: 'Test Pulse Suite v2.1.0',
      projectId: projectId || 'N/A',
      projectName: activeReportData.projectName || 'Proyecto',
      projectKey: activeReportData.projectKey || '',
      recipients: activeReportData.recipients || '',
      emailSubject: activeReportData.emailSubject || `[Reporte Ejecutivo] ${activeReportData.projectName}`,
      htmlReport: activeReportData.htmlReport || '',
      plainText: activeReportData.plainText || '',
      summary: activeReportData.summary || {},
      stats: activeReportData.stats || {}
    };

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(bodyPayload)
    });

    const isSuccess = webhookRes.ok || (webhookRes.status >= 200 && webhookRes.status < 300);
    let resText = '';
    try {
      resText = await webhookRes.text();
    } catch (_) {}

    const dispatchLog = {
      timestamp: new Date().toISOString(),
      status: isSuccess ? 'SUCCESS' : 'ERROR',
      statusCode: webhookRes.status,
      statusText: webhookRes.statusText || (isSuccess ? 'OK' : 'Error'),
      responseSummary: resText ? resText.substring(0, 300) : '',
      recipients: reportData?.recipients || 'Configurados en regla de Jira',
      emailSubject: bodyPayload.emailSubject
    };

    if (projectId) {
      await setAppStorage(`report_automation_last_dispatch_${projectId}`, dispatchLog);
    }

    if (!isSuccess) {
      return {
        success: false,
        statusCode: webhookRes.status,
        error: `Jira Automation respondió con código ${webhookRes.status} (${webhookRes.statusText || 'Error'}). ${resText || ''}`,
        lastDispatch: dispatchLog
      };
    }

    return {
      success: true,
      statusCode: webhookRes.status,
      message: 'Reporte ejecutivo enviado exitosamente a Jira Automation',
      lastDispatch: dispatchLog
    };
  } catch (err) {
    console.error('[triggerManualReportDispatch] Error:', err);
    return { success: false, error: err.message };
  }
});

export async function scheduledReportHandler(event, context) {
  try {
    console.log('[scheduledReportHandler] Running scheduled report check...');
    const activeProjects = (await getAppStorage('report_automation_active_projects')) || [];
    if (!Array.isArray(activeProjects) || activeProjects.length === 0) {
      console.log('[scheduledReportHandler] No active report automation projects found.');
      return;
    }

    const now = new Date();
    // Convert to America/Mexico_City time (UTC-6)
    const cdmxDateStr = now.toLocaleString("en-US", { timeZone: "America/Mexico_City" });
    const cdmxDate = new Date(cdmxDateStr);
    const currentHour = cdmxDate.getHours();
    const currentDay = cdmxDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday

    for (const projectId of activeProjects) {
      try {
        const config = await getAppStorage(`report_automation_config_${projectId}`);
        if (!config || !config.enabled || !config.webhookUrl) continue;

        const targetHour = parseInt(config.hour || '18', 10);
        if (currentHour !== targetHour) continue;

        // Check frequency
        if (config.frequency === 'weekdays' && (currentDay === 0 || currentDay === 6)) {
          continue; // Skip weekends
        } else if (config.frequency === 'weekly') {
          const targetDay = parseInt(config.weeklyDay ?? '5', 10);
          if (currentDay !== targetDay) continue;
        }

        // Prevent duplicate execution in the same day & hour
        const lastDispatch = await getAppStorage(`report_automation_last_dispatch_${projectId}`);
        if (lastDispatch && lastDispatch.timestamp) {
          const lastDate = new Date(lastDispatch.timestamp);
          const lastCdmxStr = lastDate.toLocaleString("en-US", { timeZone: "America/Mexico_City" });
          const lastCdmxDate = new Date(lastCdmxStr);
          if (lastCdmxDate.toDateString() === cdmxDate.toDateString() && lastCdmxDate.getHours() === currentHour) {
            console.log(`[scheduledReportHandler] Project ${projectId} already ran for this hour.`);
            continue;
          }
        }

        // Fetch project metadata
        let projectName = `Proyecto ${projectId}`;
        let projectKey = projectId;
        try {
          const pRes = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}`);
          if (pRes.ok) {
            const pData = await pRes.json();
            projectName = pData.name || projectName;
            projectKey = pData.key || projectKey;
          }
        } catch (_) {}

        const dateFormatted = cdmxDate.toLocaleDateString('es-ES', { 
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
        });

        // Trigger webhook for Jira Automation
        const bodyPayload = {
          timestamp: now.toISOString(),
          source: 'Test Pulse Suite Scheduled Trigger',
          projectId,
          projectName,
          projectKey,
          recipients: config.recipients || '',
          emailSubject: `[Reporte Ejecutivo Programado] ${projectName} - ${dateFormatted}`,
          dateFormatted,
          scheduledHour: `${config.hour}:00 CDMX`
        };

        const res = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        await setAppStorage(`report_automation_last_dispatch_${projectId}`, {
          timestamp: now.toISOString(),
          status: res.ok ? 'SUCCESS' : 'ERROR',
          statusCode: res.status,
          statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
          recipients: config.recipients || 'Configurados en regla de Jira',
          emailSubject: bodyPayload.emailSubject
        });
        console.log(`[scheduledReportHandler] Project ${projectId} dispatched with status ${res.status}`);
      } catch (projErr) {
        console.error(`[scheduledReportHandler] Error processing project ${projectId}:`, projErr);
      }
    }
  } catch (err) {
    console.error('[scheduledReportHandler] Fatal error:', err);
  }
}

export const handler = resolver.getDefinitions();
