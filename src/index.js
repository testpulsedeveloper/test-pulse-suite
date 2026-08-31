import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

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

async function fetchJqlPage(jql, fields, expand, properties, nextPageToken = null, maxResults = 100) {
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
    if (properties) body.properties = Array.isArray(properties) ? properties : [properties];

    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

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


// === Folder Management (Jira Entity Properties) ===
const getProjectFolders = async (projectId) => {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-folders`);
    if (response.status === 404) return [];
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
    let data = await response.json();
    let projects = Array.isArray(data) ? data : (data.values || []);

    if (projects.length === 0) {
      // Fallback to asApp() in case of user permission scheme quirks
      response = await api.asApp().requestJira(route`/rest/api/3/project`);
      data = await response.json();
      projects = Array.isArray(data) ? data : (data.values || []);
    }

    if (projects.length === 0) {
      return [];
    }
    
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
    const data = await response.json();
    return data.issueLinkTypes || [];
  } catch(e) {
    console.error("Error getIssueLinkTypes:", e);
    return [];
  }
});

resolver.define('getConfig', async ({ payload }) => {
  try {
    const { projectId } = payload;
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
    if (response.status === 404) {
      console.log("Config not found, returning defaults");
      return { testCaseType: '', testCycleType: '', planIssueType: '', requirementIssueTypes: [], requirementLinkType: 'ANY' };
    }
    const data = await response.json();
    console.log("Fetched config:", data.value);
    
    // Ensure new array properties have defaults
    const config = data.value;
    if (!config.requirementIssueTypes) config.requirementIssueTypes = [];
    if (!config.requirementLinkType) config.requirementLinkType = 'ANY';
    
    return config;
  } catch(e) {
    console.error("Error getConfig:", e);
    return { testCaseType: '', testCycleType: '', planIssueType: '', requirementIssueTypes: [], requirementLinkType: 'ANY' };
  }
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
    const planType = config?.planIssueType || 'Test Set';
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    
    const jql = `${projectJql}issuetype = "${planType}" ORDER BY created DESC`;
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, null);
    return allIssues.map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name
    }));
  } catch (e) {
    console.error("getTestPlans exception:", e);
    return { _isError: true, message: String(e) };
  }
});

resolver.define('getTestCycles', async ({ payload }) => {
  try {
    const { projectId, config } = payload;
    const cycleType = config?.testCycleType || 'Test Cycle';
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    
    const jql = `${projectJql}issuetype = "${cycleType}" ORDER BY created DESC`;
    const allIssues = await fetchAllIssues(jql, ['summary', 'status', 'created'], null, ['testops-plan-link']);
    return allIssues.map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || 'To Do',
      planId: issue.properties && issue.properties['testops-plan-link'] ? issue.properties['testops-plan-link'].planId : null
    }));
  } catch (e) {
    console.error("getTestCycles exception:", e);
    return { _isError: true, message: String(e) };
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
  const testCaseType = config?.testCaseType || 'Test Case';
  
  const projectJql = projectId ? `project = ${projectId} AND ` : '';
  const typeJql = testCaseType ? `issuetype = "${testCaseType}"` : `issuetype IN ("Test Case", "Test")`;
  const jql = `${projectJql}${typeJql} ORDER BY created DESC`;
  
  let fieldsToFetch = ['summary', 'status', 'created', 'issuelinks', 'issuetype', 'priority', 'labels', 'customfield_10014', 'customfield_10534'];
  if (payload?.executionTypeFieldId) {
     fieldsToFetch.push(payload.executionTypeFieldId);
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
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${caseId}/properties/testpulse-format`);
  if (response.status === 404) {
    return { type: 'traditional', content: [] };
  }
  const data = await response.json();
  return data.value;
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

// === Execution Management (Jira Entity Properties) ===
const getExecutionData = async (cycleId) => {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  if (response.status === 404) return [];
  const data = await response.json();
  const value = data.value || [];

  if (value.length === 0) return [];

  const testIds = (typeof value[0] === 'object') ? value.map(t => String(t.id)) : value.map(String);
  if (!Array.isArray(testIds) || testIds.length === 0) return [];

  // Process in batches of 10 with 200ms delay between batches to avoid 429 rate limiting
  // (was 25 concurrent with no delay — too aggressive for Jira Cloud limits)
  const props = await processInBatches(testIds, 10, 200, async (id) => {
    let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}?t=${Date.now()}`);
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}?t=${Date.now()}`);
    }
    if (res.ok) {
      const d = await res.json();
      return d.value || { id: String(id), status: 'Not Run', linkedBugs: [] };
    }
    return { id: String(id), status: 'Not Run', linkedBugs: [] };
  });

  return props.filter(Boolean);
};


// Fast initial load endpoint — heals legacy format on the fly
const getCycleExecutionSummary = async (cycleId) => {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  if (response.status === 404) return [];
  const data = await response.json();
  const value = data.value || [];

  if (value.length === 0) return [];

  // Modern format: lightweight index has objects with real statuses
  if (typeof value[0] === 'object') {
      // If any entry has _stub:true it was written by fast-migration and needs real statuses
      const hasStubs = value.some(ex => ex._stub === true);
      if (!hasStubs) return value;
      // Fall through to heal stubs below
  }

  // Legacy format (array of ID strings): heal by reading real exec_ properties
  // and write back the corrected index so future loads are fast
  console.log(`[getCycleExecutionSummary] Legacy format for ${cycleId} — healing index`);
  const realData = await getExecutionData(cycleId);
  if (realData && realData.length > 0) {
      const healed = realData.map(ex => ({
          id: String(ex.id),
          status: ex.status || 'Not Run',
          linkedBugs: ex.linkedBugs || [],
          executedBy: ex.executedBy
      }));
      // Write back healed index asynchronously (don't block the response)
      api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(healed)
      });
      return healed;
  }

  // Absolute fallback: return stubs so the UI at least shows the test cases
  return value.map(id => ({ id: String(id), status: 'Not Run', linkedBugs: [] }));
};


const updateLightweightIndex = async (cycleId, updateFn) => {
    let lightWeight = [];
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
    if (response.status !== 404) {
        const data = await response.json();
        const value = data.value || [];
        if (value.length > 0 && typeof value[0] === 'object' && !value.some(ex => ex._stub === true)) {
            // Modern format, fully healed: use directly
            lightWeight = value;
        } else if (value.length > 0) {
            // Legacy format (just IDs): MUST read real statuses from exec_ properties first
            // to avoid corrupting all statuses to "Not Run" on write-back
            console.log(`[updateLightweightIndex] Legacy format detected for ${cycleId} — healing before update`);
            const realData = await getExecutionData(cycleId);
            if (realData && realData.length > 0) {
                lightWeight = realData.map(ex => ({
                    id: String(ex.id),
                    status: ex.status || 'Not Run',
                    linkedBugs: ex.linkedBugs || [],
                    executedBy: ex.executedBy
                }));
            } else {
                // Fallback: no real data available, at least keep the IDs
                lightWeight = value.map(id => ({ id: String(id), status: 'Not Run', linkedBugs: [] }));
            }
        }
    }

    lightWeight = updateFn(lightWeight);

    let exRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(lightWeight)
    });
    if (exRes.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        exRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(lightWeight)
        });
    }
    if (!exRes.ok) {
        const errText = await exRes.text();
        console.error("Failed to update lightweight index:", errText);
    }
};


const setExecutionData = async (cycleId, data) => {
  const testIds = data.map(t => t.id);
  
  // Procesar en chunks de 15 para evitar HTTP 429
  const CHUNK_SIZE = 15;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(t => 
         api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
           method: 'PUT',
           headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
           body: JSON.stringify(t)
         })
      ));
  }
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error('Failed to set execution list:', errText);
    throw new Error('Failed to save cycle data list: ' + errText);
  }
};

resolver.define('getExecutionReport', async ({ payload }) => {
  const { projectId, config } = payload;
  const cycleType = config?.testCycleType || 'Test Cycle';
  
  const jql = `project = ${projectId} AND issuetype = "${cycleType}" ORDER BY created DESC`;
  let allIssues = [];
  let token = null;
  let isLast = false;
  while (!isLast) {
      const page = await fetchJqlPage(jql, ['summary', 'issuetype'], null, ['testops-plan-link', 'execution'], token, 100);
      if (page.error) break;
      allIssues = allIssues.concat(page.issues);
      token = page.nextPageToken;
      isLast = page.isLast;
      if (!token) break;
  }
  // Process cycles in batches of 3 with 500ms delay to avoid rate-limit bursts.
  // Cycles without healing needs are fast (just reads lightweight index).
  // Cycles that need healing call getExecutionData (N sub-requests) — limiting concurrency here
  // prevents the worst case: Promise.all on 20 cycles × 50 tests = 1000 simultaneous requests.
  const cycles = await processInBatches(allIssues, 3, 500, async (issue) => {
    const properties = issue.properties || {};
    const planId = properties['testops-plan-link']?.planId || null;
    const executionRaw = properties['execution'] || [];
    let execution = [];

    if (Array.isArray(executionRaw) && executionRaw.length > 0) {
      if (typeof executionRaw[0] === 'object') {
        execution = executionRaw;

        // Stubs have _stub:true — written by fast-migration, all statuses 'Not Run'.
        // Must heal same as legacy format (read exec_ properties for real statuses).
        const hasStubs = execution.some(ex => ex._stub === true);

        // Also heal if any executed test is missing executedBy (stale lightweight index)
        const needsHeal = hasStubs || execution.some(
          ex => ex.status && ex.status !== 'Not Run' && ex.executedBy === undefined
        );
        if (needsHeal) {
          const fullData = await getExecutionData(issue.id);
          execution = fullData.map(ex => ({
            id: String(ex.id),
            status: ex.status,
            linkedBugs: ex.linkedBugs || [],
            executedBy: ex.executedBy
          }));
          // Write back healed index (fire-and-forget)
          api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/properties/execution`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(execution)
          });
        }
      } else {
        // Legacy format — heal to objects with real statuses
        const fullData = await getExecutionData(issue.id);
        execution = fullData.map(ex => ({
          id: String(ex.id),
          status: ex.status,
          linkedBugs: ex.linkedBugs || [],
          executedBy: ex.executedBy
        }));
        // Write back healed index (fire-and-forget)
        api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/properties/execution`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(execution)
        });
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

  if (allBugKeys.size > 0) {
const sevField = 'customfield_10238';
     const bugMap = {};
     await Promise.all(Array.from(allBugKeys).map(async key => {
         try {
            const fieldsToFetch = ['summary', 'status', 'assignee', 'resolution', 'priority', 'created', sevField].join(',');
            const resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?expand=changelog&fields=${fieldsToFetch}`);
            if (resp.status === 200) {
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

               bugMap[key] = {
                 summary: i.fields?.summary,
                 status: i.fields?.status?.name,
                 assignee: i.fields?.assignee?.displayName || 'Sin asignar',
                 resolution: i.fields?.resolution?.name || 'Unresolved',
                 severity: i.fields?.[sevField] ? (typeof i.fields[sevField] === 'object' ? (i.fields[sevField].value || i.fields[sevField].name || i.fields[sevField]) : i.fields[sevField]) : 'N/A',
                 rawFields: i.fields,
                 timesSpent
               };
            }
         } catch (e) {
            console.error('Error fetching bug ' + key, e);
         }
     }));

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

  return { cycles };
});


resolver.define('getCycleExecution', async ({ payload }) => {
  const { cycleId } = payload;
  return await getExecutionData(cycleId);
});

resolver.define('getCycleExecutionSummary', async ({ payload }) => {
  const { cycleId } = payload;
  return await getCycleExecutionSummary(cycleId);
});

resolver.define('getTestExecution', async ({ payload }) => {
  const { cycleId, testId } = payload;
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}?t=${Date.now()}`);
  if (res.ok) {
    const data = await res.json();
    return data.value;
  }
  return null;
});

resolver.define('addBulkTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;

  // Read the lightweight index ONCE — single GET request
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  let lightWeightIndex = [];
  if (response.status !== 404) {
      const data = await response.json();
      const value = data.value || [];
      if (value.length > 0 && typeof value[0] === 'object') {
          lightWeightIndex = value;
      } else if (value.length > 0) {
          // Legacy format: heal before proceeding to avoid corrupting statuses
          const realData = await getExecutionData(cycleId);
          if (realData && realData.length > 0) {
              lightWeightIndex = realData.map(ex => ({
                  id: String(ex.id),
                  status: ex.status || 'Not Run',
                  linkedBugs: ex.linkedBugs || [],
                  executedBy: ex.executedBy
              }));
          }
      }
  }

  const existingIds = new Set(lightWeightIndex.map(t => String(t.id)));
  const newTests = []; // tests that need exec_ property written
  const addedTests = []; // all tests for response (includes historical data)

  for (const tc of testCases) {
      if (existingIds.has(String(tc.id))) {
          // Already in index: return its data as historical, no write needed
          const existing = lightWeightIndex.find(t => String(t.id) === String(tc.id));
          addedTests.push({ id: tc.id, key: tc.key, summary: tc.summary, status: 'Not Run', _historicalData: existing });
      } else {
          // Truly new: needs exec_ property created
          const newTest = { id: tc.id, key: tc.key, summary: tc.summary, status: 'Not Run' };
          newTests.push(newTest);
          addedTests.push(newTest);
      }
  }

  // Write exec_ properties for new tests in parallel chunks (no GET check — index is source of truth)
  if (newTests.length > 0) {
      const CHUNK_SIZE = 10;
      for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
          const chunk = newTests.slice(i, i + CHUNK_SIZE);
          await Promise.all(chunk.map(async (t) => {
              let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
                  method: 'PUT',
                  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                  body: JSON.stringify(t)
              });
              if (res.status === 429) {
                  await new Promise(r => setTimeout(r, 1500));
                  res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
                      method: 'PUT',
                      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                      body: JSON.stringify(t)
                  });
              }
              if (!res.ok) {
                  const errText = await res.text();
                  throw new Error(`Jira PUT exec_${t.id} failed with ${res.status}: ${errText}`);
              }
          }));
      }

      // Update lightweight index directly — single PUT using data already in memory (no extra GET)
      const updatedIndex = [...lightWeightIndex];
      newTests.forEach(nt => {
          if (!updatedIndex.some(t => String(t.id) === String(nt.id))) {
              updatedIndex.push({ id: String(nt.id), status: 'Not Run', linkedBugs: [] });
          }
      });

      let indexRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedIndex)
      });
      if (indexRes.status === 429) {
          await new Promise(r => setTimeout(r, 2000));
          await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
              method: 'PUT',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedIndex)
          });
      }
  }

  return { success: true, addedTests };
});


resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase } = payload;
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  const newTest = {
    id: testCase.id,
    key: testCase.key,
    summary: testCase.summary,
    status: 'Not Run'
  };
  
  let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${newTest.id}?t=${Date.now()}`);
  let res;
  if (checkRes.status === 404) {
      res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${newTest.id}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(newTest)
      });
  } else {
      const existingData = await checkRes.json();
      if (existingData && existingData.value) {
          newTest._historicalData = existingData.value;
      }
      res = { ok: true, status: 200, text: async () => "" };
  }
  
  if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${newTest.id}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(newTest)
      });
  }
  
  if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jira PUT exec_${newTest.id} failed with ${res.status}: ${errText}`);
  }
  
  await updateLightweightIndex(cycleId, (lw) => {
      if (!lw.find(t => String(t.id) === String(newTest.id))) {
          lw.push({ id: String(newTest.id), status: newTest.status, linkedBugs: newTest.linkedBugs || [] });
      }
      return lw;
  });
  
  return { success: true, addedTest: newTest };
});

resolver.define('addMultipleTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  let changed = false;
  const newTests = [];
  for (const testCase of testCases) {
      newTests.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        status: 'Not Run'
      });
      if (!testIds.includes(testCase.id)) {
          testIds.push(testCase.id);
      }
      changed = true;
  }

  if (changed) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (nt) => {
           let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${nt.id}`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(nt)
           });
           if (res.status === 429) {
               await new Promise(r => setTimeout(r, 2000));
               res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${nt.id}`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(nt)
               });
           }
           if (!res.ok) {
               const errText = await res.text();
               throw new Error(`Jira PUT exec_${nt.id} failed with ${res.status}: ${errText}`);
           }
        }));
    }
    
    await updateLightweightIndex(cycleId, (lw) => {
        newTests.forEach(nt => {
            if (!lw.find(t => String(t.id) === String(nt.id))) {
                lw.push({ id: String(nt.id), status: nt.status, linkedBugs: nt.linkedBugs || [] });
            }
        });
        return lw;
    });
  }
  return { success: true };
});

resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  await updateLightweightIndex(cycleId, (lw) => lw.filter(t => String(t.id) !== String(testId)));
  
  // Delete the individual property
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`, {
     method: 'DELETE'
  });
  
  return { success: true };
});

resolver.define('updateTestStatus', async ({ payload }) => {
  const { cycleId, testId, status, comment, evidence, evidences, linkedBugs, steps, iterations, projectId, takeover } = payload;
  
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

  let resTest = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`);
  let t = null;
  if (resTest.ok) {
      t = (await resTest.json()).value;
  }

  // ── Lock enforcement: prevent resetting a completed execution to "Not Run" ──
  const TERMINAL = ['Pass', 'Passed', 'Fail', 'Failed', 'Blocked'];
  if (t && t.lockedAt && status === 'Not Run' && !isAdmin) {
      throw new Error('LOCKED: Esta ejecución ya fue completada. Solo un administrador puede resetear su estatus a "Not Run".');
  }

  let updatedTest = null;
  if (t) {
      if (!takeover && t.executedBy && userData && t.executedBy.accountId !== userData.accountId && !isAdmin) {
          throw new Error('Solo el usuario que ejecutó la prueba original o un administrador puede modificarla.');
      }
      const newStatus = status !== undefined ? status : t.status;
      updatedTest = {
          ...t,
          status: newStatus,
          comment: comment !== undefined ? comment : t.comment,
          evidence: evidence !== undefined ? evidence : t.evidence,
          evidences: evidences !== undefined ? evidences : t.evidences,
          linkedBugs: linkedBugs !== undefined ? linkedBugs : t.linkedBugs,
          steps: steps !== undefined ? steps : t.steps,
          iterations: iterations !== undefined ? iterations : t.iterations,
          executedBy: executorInfo !== undefined ? executorInfo : t.executedBy,
          // Stamp lockedAt when reaching a terminal status for the first time
          lockedAt: TERMINAL.includes(newStatus) ? (t.lockedAt || Date.now()) : t.lockedAt
      };
  } else {
      // exec_ doesn't exist yet — first time executing this test.
      const newStatus = status !== undefined ? status : 'Not Run';
      updatedTest = {
          id: String(testId),
          status: newStatus,
          comment: comment !== undefined ? comment : '',
          evidence: evidence !== undefined ? evidence : null,
          evidences: evidences !== undefined ? evidences : [],
          steps: steps !== undefined ? steps : [],
          iterations: iterations !== undefined ? iterations : [],
          linkedBugs: linkedBugs !== undefined ? linkedBugs : [],
          executedBy: executorInfo || null,
          description: null,
          lockedAt: TERMINAL.includes(newStatus) ? Date.now() : null
      };
  }

  if (updatedTest) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${testId}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedTest)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Failed to save test data: ' + errText);
    }

    await updateLightweightIndex(cycleId, (lw) => {
        const item = lw.find(l => String(l.id) === String(testId));
        if (item) {
            item.status = updatedTest.status;
            item.linkedBugs = updatedTest.linkedBugs || [];
            item.executedBy = updatedTest.executedBy;
            if (updatedTest.lockedAt) item.lockedAt = updatedTest.lockedAt;
        } else {
            lw.push({
                id: String(testId),
                status: updatedTest.status,
                linkedBugs: updatedTest.linkedBugs || [],
                executedBy: updatedTest.executedBy,
                ...(updatedTest.lockedAt ? { lockedAt: updatedTest.lockedAt } : {})
            });
        }
        return lw;
    });
  }

  return { success: true, lockedAt: updatedTest?.lockedAt || null };
});


// Backfills missing description snapshots for tests already in a cycle
resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId, testIds, force } = payload;
  if (!testIds || testIds.length === 0) return await getExecutionData(cycleId);

  let executionData = await getExecutionData(cycleId);

  try {
    const CHUNK_SIZE = 50;
    const descMap = {};
    const rawFieldsMap = {};
    const renderedFieldsMap = {};
    
    for (let i = 0; i < testIds.length; i += CHUNK_SIZE) {
        const chunk = testIds.slice(i, i + CHUNK_SIZE);
        const jql = `id in (${chunk.join(',')})`;
        
        let response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ jql, fields: ['summary', 'description', 'environment'], expand: 'renderedFields', maxResults: 100 })
        });
        
        if (response.status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ jql, fields: ['summary', 'description', 'environment'], expand: 'renderedFields', maxResults: 100 })
            });
        }

        if (response.ok) {
            const data = await response.json();
            const issues = data.issues || [];
            for (const issue of issues) {
              descMap[issue.id] = issue.renderedFields?.description || issue.fields?.description || '';
              rawFieldsMap[issue.id] = issue.fields || {};
              renderedFieldsMap[issue.id] = issue.renderedFields || {};
            }
        } else {
            console.error("backfill chunk search failed:", response.status, await response.text());
        }
    }

    const updatedTests = [];
    executionData = executionData.map(t => {
       if (descMap[t.id] !== undefined || force) {
           const updated = { 
               ...t, 
               description: descMap[t.id] !== undefined ? descMap[t.id] : t.description, 
               expectedResult: renderedFieldsMap[t.id]?.environment || rawFieldsMap[t.id]?.environment || t.expectedResult || ''
           };
           updatedTests.push(updated);
           return updated;
       }
       return t;
    });

    const PUT_CHUNK = 10;
    for (let i = 0; i < updatedTests.length; i += PUT_CHUNK) {
        const chunk = updatedTests.slice(i, i + PUT_CHUNK);
        await Promise.all(chunk.map(async (t) => {
            let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
               method: 'PUT',
               headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
               body: JSON.stringify(t)
            });
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 1500));
                res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
                   method: 'PUT',
                   headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                   body: JSON.stringify(t)
                });
            }
        }));
    }

  } catch (e) {
    console.error('backfillDescriptions error:', e);
  }

  return executionData;
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
    const cycleType = config?.testCycleType || 'Test Cycle';
    const projectJql = projectId ? `project = "${projectId}" AND ` : '';
    
    // Fetch all test cycles AND the specific property for this test case in one go!
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: `${projectJql}issuetype = "${cycleType}" ORDER BY created DESC`,
        fields: ['summary', 'created'],
        properties: [`exec_${testId}`, 'execution'],
        maxResults: 200
      })
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const history = [];
    
    // For each cycle, read its execution data directly from memory
    for (const cycle of (data.issues || [])) {
      const properties = cycle.properties || {};
      
      let testExec = null;
      // 1. Try modern O(1) properties approach
      if (properties[`exec_${testId}`]) {
        testExec = properties[`exec_${testId}`];
      } 
      // 2. Fallback to legacy execution array if present in properties
      else if (Array.isArray(properties['execution']) && typeof properties['execution'][0] === 'object') {
        testExec = properties['execution'].find(t => String(t.id) === String(testId));
      }
      
      if (testExec) {
        history.push({
          cycleId: cycle.id,
          cycleKey: cycle.key,
          cycleSummary: cycle.fields.summary,
          status: testExec.status || 'Not Run',
          executedBy: testExec.executedBy,
          iterations: testExec.iterations || [],
          comment: testExec.comment
        });
      }
    }
    
    return history;
  } catch (e) {
    console.error("getTestCaseHistory error:", e);
    return [];
  }
});


resolver.define('getIssueDescription', async ({ payload }) => {
  try {
    const { issueId } = payload;
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?expand=renderedFields&fields=description`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.renderedFields?.description || data.fields?.description || null;
  } catch (e) {
    console.error("Error fetching description:", e);
    return null;
  }
});

// Recovery endpoint: rebuilds the execution index from exec_ properties.
// Paginated: processes 50 exec_ keys per call to stay within Forge 25s limit.
// Frontend loops calling with increasing offset until done=true.
resolver.define('rebuildCycleIndex', async ({ payload }) => {
  const { cycleId, offset = 0, limit = 50 } = payload;

  // Step 1: List ALL property keys on the cycle (1 request, always fast)
  const keysRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties`);
  if (!keysRes.ok) throw new Error(`Failed to list properties: ${keysRes.status}`);
  const keysData = await keysRes.json();
  const execKeys = (keysData.keys || []).map(k => k.key).filter(k => k.startsWith('exec_'));

  if (execKeys.length === 0) {
    return { success: true, rebuilt: 0, total: 0, done: true, message: 'No exec_ properties on this cycle' };
  }

  const total = execKeys.length;
  const pageKeys = execKeys.slice(offset, offset + limit);

  // Step 2: Read this page of exec_ properties (batches of 15, 100ms delay)
  const pageData = await processInBatches(pageKeys, 15, 100, async (key) => {
    const testId = key.replace('exec_', '');
    let r = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${key}`);
    if (r.status === 429) {
      await new Promise(x => setTimeout(x, 2000));
      r = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/${key}`);
    }
    if (!r.ok) return null;
    const d = await r.json();
    const val = d.value || {};
    return {
      id: String(val.id || testId),
      status: val.status || 'Not Run',
      linkedBugs: val.linkedBugs || [],
      executedBy: val.executedBy
    };
  });

  // Step 3: Read the current execution index (accumulator from previous calls)
  let currentIndex = [];
  if (offset > 0) {
    const idxRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`);
    if (idxRes.ok) {
      const idxData = await idxRes.json();
      currentIndex = idxData.value || [];
      if (!Array.isArray(currentIndex) || (currentIndex.length > 0 && typeof currentIndex[0] !== 'object')) {
        currentIndex = []; // reset if legacy
      }
    }
  }

  // Step 4: Merge page results with accumulated index
  const newEntries = pageData.filter(Boolean);
  const merged = [...currentIndex, ...newEntries];

  // Step 5: Write back accumulated index
  let putRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(merged)
  });
  if (putRes.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    putRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    });
  }
  if (!putRes.ok) throw new Error(`Failed to write index: ${putRes.status}`);

  const done = (offset + limit) >= total;
  return {
    success: true,
    rebuilt: merged.length,
    total,
    done,
    nextOffset: done ? null : offset + limit
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

      let res = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/properties/execution`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(stubIndex)
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        res = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/properties/execution`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(stubIndex)
        });
      }
      if (res.ok) {
        results.migrated++;
      } else {
        results.errors.push(`${issue.key}: ${res.status}`);
      }
    } catch (err) {
      results.errors.push(`${issue.key}: ${err.message}`);
    }
  }

  results.done = results.processed >= total;
  results.nextOffset = results.done ? null : offset + limit;
  return results;
});


// ── Bugs del proyecto que NO están vinculados a ninguna ejecución en Test Pulse ──
resolver.define('getProjectUnlinkedBugs', async ({ payload }) => {
  const { projectId, linkedBugKeys = [] } = payload;
  if (!projectId) return [];

  const linkedSet = new Set(linkedBugKeys);

  // Query Jira: all Bugs in the project (limit 100 most recent)
  const jql = encodeURIComponent(`project = "${projectId}" AND issuetype in (Bug, Defect) ORDER BY created DESC`);
  const fields = 'summary,status,assignee,priority,resolution,created,reporter';
  const res = await api.asUser().requestJira(
    route`/rest/api/3/search?jql=${decodeURIComponent(jql)}&fields=${fields}&maxResults=100`
  );
  if (!res.ok) {
    console.warn(`getProjectUnlinkedBugs: search failed ${res.status}`);
    return [];
  }
  const data = await res.json();

  return (data.issues || [])
    .filter(issue => !linkedSet.has(issue.key))
    .map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || '',
      statusCategory: issue.fields?.status?.statusCategory?.key || '',
      assignee: issue.fields?.assignee?.displayName || null,
      priority: issue.fields?.priority?.name || null,
      resolution: issue.fields?.resolution?.name || null,
      reporter: issue.fields?.reporter?.displayName || null,
      created: issue.fields?.created || null,
    }));
});



export const handler = resolver.getDefinitions();
