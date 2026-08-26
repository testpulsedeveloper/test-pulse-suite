const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `resolver.define('addBulkTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  let executionData = await getExecutionData(cycleId);
  const testIds = executionData.map(t => t.id);
  
  const newTests = [];
  for (const tc of testCases) {
    if (!testIds.includes(tc.id)) {
      const newTest = {
        id: tc.id,
        key: tc.key,
        summary: tc.summary,
        description: tc.description,
        status: 'Not Run',
        rawFields: tc.rawFields,
        renderedFields: tc.renderedFields
      };
      executionData.push(newTest);
      newTests.push(newTest);
      testIds.push(tc.id);
    }
  }
  
  if (newTests.length > 0) {
    // Escribir los nuevos uno por uno (o de forma segura) para no tronar por 429
    for (const t of newTests) {
       await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       });
    }
    
    // Y luego actualizamos el array principal de IDs
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return executionData;
});`;

const replacement = `resolver.define('addBulkTestsToCycle', async ({ payload }) => {
  const { cycleId, testCases } = payload;
  
  // LEER SOLO LOS IDs, sin descargar todos los objetos para evitar tronar por rate limits y perder datos (Data Loss)
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      if (typeof data.value[0] !== 'object') {
          testIds = data.value || [];
      } else {
          testIds = data.value.map(t => t.id);
      }
  }
  
  const newTests = [];
  for (const tc of testCases) {
    if (!testIds.includes(tc.id)) {
      const newTest = {
        id: tc.id,
        key: tc.key,
        summary: tc.summary,
        description: tc.description,
        status: 'Not Run',
        rawFields: tc.rawFields,
        renderedFields: tc.renderedFields
      };
      newTests.push(newTest);
      testIds.push(tc.id);
    }
  }
  
  if (newTests.length > 0) {
    // Escribir los nuevos uno por uno (o de forma segura) para no tronar por 429
    for (const t of newTests) {
       await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       });
    }
    
    // Y luego actualizamos el array principal de IDs
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  
  return { success: true };
});`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched addBulkTestsToCycle");
} else {
    console.error("Could not find target in addBulkTestsToCycle");
}
