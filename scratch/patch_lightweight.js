const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// 1. In updateTestStatus, we need to update the execution property with lightweight objects
const updateTestTarget = `    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Failed to save test data: ' + errText);
    }
  }`;
const updateTestReplace = `    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Failed to save test data: ' + errText);
    }
    
    // Update the lightweight index
    const lightWeight = updatedData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(lightWeight)
    });
  }`;
content = content.replace(updateTestTarget, updateTestReplace);

// 2. In removeTestFromCycle, update the lightweight index
const removeTestTarget = `  const filtered = executionData.filter(t => t.id !== testId);
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(filtered.map(t => t.id))
  });`;
const removeTestReplace = `  const filtered = executionData.filter(t => t.id !== testId);
  const lightWeight = filtered.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(lightWeight)
  });`;
content = content.replace(removeTestTarget, removeTestReplace);

// 3. In addTestToCycle and addBulkTestsToCycle, we need to reconstruct the lightweight index from getExecutionData!
// For addTestToCycle:
const singleAddTarget = `  if (!testIds.includes(testCase.id)) {
      testIds.push(testCase.id);
  }
  let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });`;
const singleAddReplace = `  // Get current full data to reconstruct lightweight index
  const fullData = await getExecutionData(cycleId);
  if (!fullData.find(t => t.id === newTest.id)) fullData.push(newTest);
  const lightWeight = fullData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
  let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(lightWeight)
  });`;
content = content.replace(singleAddTarget, singleAddReplace);

// For addBulkTestsToCycle:
const bulkAddTarget = `    // Y luego actualizamos el array principal de IDs
    let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });`;
const bulkAddReplace = `    // Y luego actualizamos el array principal de IDs con formato ligero
    const fullData = await getExecutionData(cycleId);
    newTests.forEach(nt => {
        if (!fullData.find(t => t.id === nt.id)) fullData.push(nt);
    });
    const lightWeight = fullData.map(t => ({ id: t.id, status: t.status, linkedBugs: t.linkedBugs || [] }));
    let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(lightWeight)
    });`;
content = content.replace(bulkAddTarget, bulkAddReplace);

fs.writeFileSync(path, content);
console.log("Patched src/index.js with lightweight execution arrays");
