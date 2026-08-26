import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

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
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: `${projectJql}issuetype = "${planType}" ORDER BY created DESC`,
        fields: ['summary', 'status', 'created'],
        maxResults: 200
      })
    });
    
    if (!response.ok) {
      console.error(`getTestPlans failed: ${response.status} ${response.statusText}`);
      return { _isError: true, status: response.status, message: await response.text() };
    }
    const data = await response.json();
    return (data.issues || []).map(issue => ({
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
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: `${projectJql}issuetype = "${cycleType}" ORDER BY created DESC`,
        fields: ['summary', 'status', 'created'],
        properties: ['testops-plan-link'],
        maxResults: 200
      })
    });
    
    if (!response.ok) {
      console.error(`getTestCycles failed: ${response.status} ${response.statusText}`);
      return { _isError: true, status: response.status, message: await response.text() };
    }
    const data = await response.json();
    return (data.issues || []).map(issue => ({
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
  try {
    const projectId = payload?.projectId || context?.extension?.project?.id;
    const testCaseType = payload?.config?.testCaseType;
    const folderId = payload?.folderId;
    
    const projectJql = projectId ? `project = ${projectId} AND ` : '';
    const typeJql = testCaseType ? `issuetype = "${testCaseType}"` : `issuetype IN ("Test Case", "Test")`;
    const jql = `${projectJql}${typeJql} ORDER BY created DESC`;
    console.log("getTestCases JQL:", jql);
    
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql,
        fields: ['*all'],
        expand: 'renderedFields',
        properties: ['testops-folder-link'],
        maxResults: 200
      })
    });
    
    if (!response.ok) {
      console.error(`getTestCases failed: ${response.status} ${response.statusText}`);
      return { _isError: true, status: response.status, message: await response.text() };
    }
    const data = await response.json();
    console.log("getTestCases response data:", JSON.stringify(data));
    
    let cases = (data.issues || []).map(issue => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.renderedFields?.description || issue.fields.description,
      status: issue.fields.status.name,
      created: issue.fields.created,
      folderId: issue.properties?.['testops-folder-link']?.folderId || null,
      rawFields: issue.fields,
      renderedFields: issue.renderedFields
    }));

    if (folderId) {
      cases = cases.filter(c => c.folderId === folderId);
    }

    return cases;
  } catch (e) {
    console.error("getTestCases exception:", e);
    return { _isError: true, message: String(e) };
  }
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
  
  // value is now a lightweight array [{id, status}] OR an array of strings ["10001"]
  const testIds = (typeof value[0] === 'object') ? value.map(t => t.id) : value;
  
  if (testIds.length === 0) return [];
  
  // Overwrite missingIds check to use testIds instead of value
  const missingIds = testIds.filter(id => !mergedProps[`exec_${id}`]);
  
  // NEW MODE: value is an array of test IDs ["10001", "10002"]
  // To avoid HTTP 429 Rate Limits, we fetch ALL properties in ONE single JQL request!
  const bulkRes = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: `id = ${cycleId}`,
      fields: ['id'],
      properties: ['*all']
    })
  });
  
  if (!bulkRes.ok) {
     console.error("Bulk property fetch failed with status: " + bulkRes.status);
     return [];
  }
  
  const bulkData = await bulkRes.json();
  
  const properties = (bulkData.issues && bulkData.issues.length > 0) ? (bulkData.issues[0].properties || {}) : {};
  
  let mergedProps = { ...properties };
  
  const missingIds = value.filter(id => !mergedProps[`exec_${id}`]);
  
  if (missingIds.length > 0) {
      console.log(`Fetching ${missingIds.length} missing properties directly to bypass JQL index delay...`);
      
      const CHUNK_SIZE = 15;
      for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
          const chunk = missingIds.slice(i, i + CHUNK_SIZE);
          const chunkPromises = chunk.map(async (id) => {
              let res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}?t=${Date.now()}`);
              if (res.status === 429) {
                  console.log(`Hit 429 on exec_${id}, retrying once after 2 seconds...`);
                  await new Promise(r => setTimeout(r, 2000));
                  res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${id}?t=${Date.now()}`);
              }
              if (res.ok) {
                  const data = await res.json();
                  return { key: `exec_${id}`, value: data.value };
              }
              console.error(`Failed to fetch exec_${id} with status ${res.status}`);
              return null;
          });
          const resolvedChunk = await Promise.all(chunkPromises);
          resolvedChunk.forEach(prop => {
              if (prop) mergedProps[prop.key] = prop.value;
          });
      }
  }
  
  const results = testIds.map(id => mergedProps[`exec_${id}`]).filter(Boolean);
  
  return results;
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
  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      fields: ['summary', 'issuetype'],
      properties: ['*all'],
      maxResults: 100
    })
  });
  const data = await response.json();
  
  // Load execution data from memory directly using the *all properties fetched in O(1)
  const cycles = (data.issues || []).map(issue => {
    const properties = issue.properties || {};
    const planId = properties['testops-plan-link']?.planId || null;
    
    // Parse execution data locally instead of making N network requests
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else {
           execution = executionIds.map(id => properties[`exec_${id}`]).filter(Boolean);
       }
    }
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution: execution || []
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
     const bugMap = {};
     await Promise.all(Array.from(allBugKeys).map(async key => {
         try {
            const resp = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?expand=changelog&fields=summary,status,assignee,resolution,customfield_10004,priority,created`);
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
                 severity: i.fields?.customfield_10004 || i.fields?.priority?.name || 'N/A',
                 timesSpent
               };
            }
         } catch (e) {
            console.error('Error fetching bug ' + key, e);
         }
     }));

     cycles.forEach(c => {
       c.execution?.forEach(ex => {
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

resolver.define('addBulkTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  
  // LEER SOLO LOS IDs, sin descargar todos los objetos para evitar tronar por rate limits y perder datos (Data Loss)
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution?t=${Date.now()}`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      if (typeof data.value[0] !== 'object') {
          testIds = data.value || [];
      } else {
          testIds = data.value.map(t => t.id);
      }
  }
  
  // OBTENER ESTADO REAL: 
  // testIds tiene los IDs que la base de datos "cree" tener.
  // Pero si el UI envió una petición para agregar, y el backend dice que ya está,
  // puede ser que la propiedad exec_ esté huérfana.
  // Para ser seguros, SIEMPRE escribimos la propiedad si el frontend nos lo pide.
  // (El frontend oculta el botón si realmente existe en executionData).
  const newTests = [];
  for (const tc of testCases) {
      const newTest = {
        id: tc.id,
        key: tc.key,
        summary: tc.summary,
        status: 'Not Run'
      };
      newTests.push(newTest);
      if (!testIds.includes(tc.id)) {
          testIds.push(tc.id);
      }
  }
  
  if (newTests.length > 0) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (t) => {
           // Solo escribir si NO existe para no sobreescribir el estatus de pruebas ya ejecutadas
           let checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}?t=${Date.now()}`);
           if (checkRes.status === 429) {
               await new Promise(r => setTimeout(r, 1000));
               checkRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}?t=${Date.now()}`);
           }
           let res;
           if (checkRes.status === 404) {
               res = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(t)
               });
           } else {
               // Ya existe, extraer status histórico para el frontend
               const existingData = await checkRes.json();
               if (existingData && existingData.value) {
                   t._historicalData = existingData.value;
               }
               res = { ok: true, status: 200, text: async () => "" };
           }
           if (res.status === 429) {
               await new Promise(r => setTimeout(r, 2000));
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
    
    // Y luego actualizamos el array principal de IDs con formato ligero
    const fullData = await getExecutionData(cycleId);
    newTests.forEach(nt => {
        if (!fullData.find(t => t.id === nt.id)) fullData.push(nt);
    });
    const lightWeight = fullData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
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
            body: JSON.stringify(testIds)
        });
    }
    if (!exRes.ok) {
        const errText = await exRes.text();
        throw new Error(`Jira PUT execution failed with ${exRes.status}: ${errText}`);
    }
  }
  
  // Return the newly added items with their historical data
  return { success: true, addedTests: newTests };
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
  
  // Get current full data to reconstruct lightweight index
  const fullData = await getExecutionData(cycleId);
  if (!fullData.find(t => t.id === newTest.id)) fullData.push(newTest);
  const lightWeight = fullData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
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
          body: JSON.stringify(testIds)
      });
  }
  if (!exRes.ok) {
      const errText = await exRes.text();
      throw new Error(`Jira PUT execution failed with ${exRes.status}: ${errText}`);
  }
  
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
    
    let exRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
    if (exRes.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        exRes = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(testIds)
        });
    }
    if (!exRes.ok) {
        const errText = await exRes.text();
        throw new Error(`Jira PUT execution failed with ${exRes.status}: ${errText}`);
    }
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
  
  testIds = testIds.filter(id => String(id) !== String(testId));
  
  // Overwrite the execution array
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  
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

  const executionData = await getExecutionData(cycleId);
  
  let updatedTest = null;
  const updatedData = executionData.map(t => {
    if (t.id === testId) {
      // Security check
      if (!takeover && t.executedBy && userData && t.executedBy.accountId !== userData.accountId && !isAdmin) {
        throw new Error('Solo el usuario que ejecutó la prueba original o un administrador puede modificarla.');
      }

      updatedTest = { 
        ...t, 
        status: status !== undefined ? status : t.status, 
        comment: comment !== undefined ? comment : t.comment,
        evidence: evidence !== undefined ? evidence : t.evidence,
        evidences: evidences !== undefined ? evidences : t.evidences,
        linkedBugs: linkedBugs !== undefined ? linkedBugs : t.linkedBugs,
        steps: steps !== undefined ? steps : t.steps,
        iterations: iterations !== undefined ? iterations : t.iterations,
        executedBy: executorInfo !== undefined ? executorInfo : t.executedBy
      };
      return updatedTest;
    }
    return t;
  });
  
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
    
    // Update the lightweight index
    const lightWeight = updatedData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
    await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(lightWeight)
    });
  }
  
  return { success: true };
});

// Backfills missing description snapshots for tests already in a cycle
resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId, testIds } = payload;
  if (!testIds || testIds.length === 0) return await getExecutionData(cycleId);

  let executionData = await getExecutionData(cycleId);

  try {
    // Use the same JQL search pattern as getTestCases – it reliably returns renderedFields
    const jql = `id in (${testIds.join(',')})`;
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields: ['*all'], expand: 'renderedFields' })
    });

    const data = await response.json();
    const issues = data.issues || [];

    // Build a map: issueId -> renderedDescription
    const descMap = {};
    const rawFieldsMap = {};
    const renderedFieldsMap = {};
    for (const issue of issues) {
      descMap[issue.id] = issue.renderedFields?.description || issue.fields?.description || '';
      rawFieldsMap[issue.id] = issue.fields || {};
      renderedFieldsMap[issue.id] = issue.renderedFields || {};
    }

    // Patch solo los test que cambiaron (directamente en la DB) para evitar sobrescribir todo el array de execution
    const updatedTests = [];
    executionData = executionData.map(t => {
       if (descMap[t.id] !== undefined) {
           const updated = { ...t };
           updatedTests.push(updated);
           return updated;
       }
       return t;
    });

    for (const t of updatedTests) {
        await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/exec_${t.id}`, {
           method: 'PUT',
           headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
           body: JSON.stringify(t)
        });
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

export const handler = resolver.getDefinitions();
