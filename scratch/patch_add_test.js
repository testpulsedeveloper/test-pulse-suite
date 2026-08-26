const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Replace addTestToCycle to not rewrite all
const target1 = `resolver.define('addTestToCycle', async ({ payload }) => {
  const { cycleId, testCase } = payload;
  let executionData = await getExecutionData(cycleId);
  
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
    await setExecutionData(cycleId, executionData);
  }
  return executionData;
});`;

const replacement1 = `resolver.define('addTestToCycle', async ({ payload }) => {
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

content = content.replace(target1, replacement1);

// Replace addMultipleTestsToCycle to not rewrite all concurrently
const target2 = `  if (changed) {
    await setExecutionData(cycleId, executionData);
  }
  return executionData;
});`;

const replacement2 = `  if (changed) {
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

content = content.replace(target2, replacement2);

fs.writeFileSync(path, content);
console.log("Patched addTestToCycle and addMultipleTestsToCycle to avoid setExecutionData massive PUTs");
