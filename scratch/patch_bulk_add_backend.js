const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `resolver.define('addTestToCycle', async ({ payload }) => {`;

const replacement = `resolver.define('addBulkTestsToCycle', async ({ payload }) => {
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
    // Solo hacemos PUT para los NUEVOS tests
    await Promise.all(newTests.map(t => 
       api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
         method: 'PUT',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify(t)
       })
    ));
    
    // Y luego actualizamos el array principal de IDs
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }
  return executionData;
});

resolver.define('addTestToCycle', async ({ payload }) => {`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched addBulkTestsToCycle");
} else {
    console.error("Could not find target");
}
