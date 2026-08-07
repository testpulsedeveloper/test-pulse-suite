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
  const { projectId, name } = payload;
  const folders = await getProjectFolders(projectId);
  const newFolder = { id: `folder-${Date.now()}`, name, parentId: null };
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
  const updatedFolders = folders.filter(f => f.id !== folderId);
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

resolver.define('getConfig', async ({ payload }) => {
  try {
    const { projectId } = payload;
    const response = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}/properties/testops-config`);
    if (response.status === 404) {
      console.log("Config not found, returning defaults");
      return { testCaseType: '', testCycleType: '', planIssueType: '' };
    }
    const data = await response.json();
    console.log("Fetched config:", data.value);
    return data.value;
  } catch(e) {
    console.error("Error getConfig:", e);
    return { testCaseType: '', testCycleType: '', planIssueType: '' };
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
        fields: ['summary', 'status', 'created']
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
        properties: ['testops-plan-link']
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
        properties: ['testops-folder-link']
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
      rawFields: issue.fields
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
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`);
  if (response.status === 404) return [];
  const data = await response.json();
  return data.value || [];
};

const setExecutionData = async (cycleId, data) => {
  await api.asUser().requestJira(route`/rest/api/3/issue/${cycleId}/properties/execution`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

resolver.define('getExecutionReport', async ({ payload }) => {
  const { projectId, config } = payload;
  if (!config || !config.testCycleType) return { cycles: [] };
  
  const jql = `project = ${projectId} AND issuetype = "${config.testCycleType}" ORDER BY created DESC`;
  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      fields: ['summary', 'issuetype'],
      properties: ['testops-plan-link']
    })
  });
  const data = await response.json();
  
  // Load execution data from storage for each cycle (this is where linkedBugs live)
  const cycles = await Promise.all((data.issues || []).map(async issue => {
    const planId = issue.properties?.['testops-plan-link']?.planId || null;
    const execution = await getExecutionData(issue.id);
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution
    };
  }));
  
  return { cycles };
});


resolver.define('getCycleExecution', async ({ payload }) => {
  const { cycleId } = payload;
  return await getExecutionData(cycleId);
});

resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase } = payload;
  let executionData = await getExecutionData(cycleId);
  
  if (!executionData.some(t => t.id === testCase.id)) {
    executionData.push({
      id: testCase.id,
      key: testCase.key,
      summary: testCase.summary,
      description: testCase.description,
      status: 'Not Run'
    });
    await setExecutionData(cycleId, executionData);
  }
  return executionData;
});

resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  let executionData = await getExecutionData(cycleId);
  
  const updatedData = executionData.filter(t => t.id !== testId);
  
  await setExecutionData(cycleId, updatedData);
  return updatedData;
});

resolver.define('updateTestStatus', async ({ payload }) => {
  const { cycleId, testId, status, comment, evidence, evidences, linkedBugs, steps } = payload;
  const executionData = await getExecutionData(cycleId);
  
  const updatedData = executionData.map(t => {
    if (t.id === testId) {
      return { 
        ...t, 
        status: status || t.status, 
        comment: comment !== undefined ? comment : t.comment,
        evidence: evidence !== undefined ? evidence : t.evidence,
        evidences: evidences !== undefined ? evidences : t.evidences,
        linkedBugs: linkedBugs !== undefined ? linkedBugs : t.linkedBugs,
        steps: steps !== undefined ? steps : t.steps
      };
    }
    return t;
  });
  
  await setExecutionData(cycleId, updatedData);
  return updatedData;
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
      body: JSON.stringify({ jql, fields: ['description', 'summary'], expand: 'renderedFields' })
    });

    const data = await response.json();
    const issues = data.issues || [];

    // Build a map: issueId -> renderedDescription
    const descMap = {};
    for (const issue of issues) {
      descMap[issue.id] = issue.renderedFields?.description || issue.fields?.description || '';
    }

    // Patch execution data with the fetched descriptions
    executionData = executionData.map(t =>
      descMap[t.id] !== undefined ? { ...t, description: descMap[t.id] } : t
    );

    await setExecutionData(cycleId, executionData);
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
    if (data.successful) {
      results.push(...data.successful.map(item => ({ key: item.key, id: item.id, success: true })));
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

// === Bug Resolution Time ===
resolver.define('getBugsResolutionTime', async ({ payload }) => {
  const { bugKeys } = payload;
  if (!bugKeys || !Array.isArray(bugKeys) || bugKeys.length === 0) return { averageHours: 0, bugDetails: [] };
  
  let totalHours = 0;
  let count = 0;
  const bugDetails = [];

  for (const key of bugKeys) {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?expand=changelog`);
      if (response.status === 200) {
        const issue = await response.json();
        const changelog = issue.changelog?.histories || [];
        
        let inAnalysisTime = null;
        let inValidationTime = null;
        
        // Find the earliest "En analisis" and the latest "En validacion"
        for (const history of changelog) {
          const statusItem = history.items.find(item => item.field === 'status');
          if (statusItem) {
            const toString = (statusItem.toString || '').toLowerCase();
            const created = new Date(history.created).getTime();
            
            if (toString.includes('analisis') || toString.includes('análisis') || toString === 'in progress') {
              if (!inAnalysisTime || created < inAnalysisTime) {
                inAnalysisTime = created;
              }
            }
            if (toString.includes('validacion') || toString.includes('validación') || toString === 'done' || toString === 'resolved') {
              if (!inValidationTime || created > inValidationTime) {
                inValidationTime = created;
              }
            }
          }
        }
        
        if (inAnalysisTime && inValidationTime && inValidationTime > inAnalysisTime) {
          const diffMs = inValidationTime - inAnalysisTime;
          const diffHours = diffMs / (1000 * 60 * 60);
          totalHours += diffHours;
          count++;
          bugDetails.push({ key, hours: diffHours });
        }
      }
    } catch (e) {
      console.log(`Failed to fetch changelog for ${key}`, e);
    }
  }
  
  return {
    averageHours: count > 0 ? (totalHours / count) : 0,
    bugDetails
  };
});

export const handler = resolver.getDefinitions();
