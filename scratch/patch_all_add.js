const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase } = payload;
  let executionData = await getExecutionData(cycleId);
  
  if (!executionData.some(t => t.id === testCase.id)) {
    const newTest = {
      id: testCase.id,
      key: testCase.key,
      summary: testCase.summary,
      description: testCase.description,
      status: 'Not Run',
      rawFields: testCase.rawFields,
      renderedFields: testCase.renderedFields
    };
    executionData.push(newTest);
    
    // Escribir SOLO la propiedad del caso nuevo (no rescribir todos, evita rate limits)
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    });
    
    // Actualizar el índice general
    const testIds = executionData.map(t => t.id);
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return executionData;
});`;

const replacement1 = `resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase } = payload;
  
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  if (!testIds.includes(testCase.id)) {
    const newTest = {
      id: testCase.id,
      key: testCase.key,
      summary: testCase.summary,
      description: testCase.description,
      status: 'Not Run',
      rawFields: testCase.rawFields,
      renderedFields: testCase.renderedFields
    };
    
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    });
    
    testIds.push(testCase.id);
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return { success: true };
});`;

if (content.includes(target1)) {
    content = content.replace(target1, replacement1);
    fs.writeFileSync(path, content);
    console.log("Patched addTestToCycle");
} else {
    console.error("Could not find target1 in addTestToCycle");
}

const target2 = `resolver.define('addMultipleTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  let executionData = await getExecutionData(cycleId);
  
  let changed = false;
  for (const testCase of testCases) {
    if (!executionData.some(t => t.id === testCase.id)) {
      executionData.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        description: testCase.description,
        status: 'Not Run',
        rawFields: testCase.rawFields,
        renderedFields: testCase.renderedFields
      });
      changed = true;
    }
  }

  if (changed) {
    // Escribir los nuevos uno por uno (o de forma segura) para no tronar por 429
    const newTests = executionData.filter(t => testCases.some(tc => tc.id === t.id));
    for (const nt of newTests) {
      await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(nt)
      });
    }
    
    // Actualizar índice general
    const testIds = executionData.map(t => t.id);
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return executionData;
});`;

const replacement2 = `resolver.define('addMultipleTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  let changed = false;
  const newTests = [];
  for (const testCase of testCases) {
    if (!testIds.includes(testCase.id)) {
      newTests.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        description: testCase.description,
        status: 'Not Run',
        rawFields: testCase.rawFields,
        renderedFields: testCase.renderedFields
      });
      testIds.push(testCase.id);
      changed = true;
    }
  }

  if (changed) {
    for (const nt of newTests) {
      await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(nt)
      });
    }
    
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return { success: true };
});`;

if (content.includes(target2)) {
    content = content.replace(target2, replacement2);
    fs.writeFileSync(path, content);
    console.log("Patched addMultipleTestsToCycle");
} else {
    console.error("Could not find target2 in addMultipleTestsToCycle");
}
