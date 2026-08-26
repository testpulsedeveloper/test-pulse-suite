const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  let executionData = await getExecutionData(cycleId);
  
  const updatedData = executionData.filter(t => String(t.id) !== String(testId));
  const testIds = updatedData.map(t => t.id);
  
  // Overwrite the execution array
  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  
  // Delete the individual property
  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${testId}\`, {
     method: 'DELETE'
  });
  
  return updatedData;
});`;

const replacement = `resolver.define('removeTestFromCycle', async ({ payload }) => {
  const { cycleId, testId } = payload;
  
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`);
  let testIds = [];
  if (response.status !== 404) {
      const data = await response.json();
      testIds = (typeof data.value[0] !== 'object') ? data.value || [] : data.value.map(t => t.id);
  }
  
  testIds = testIds.filter(id => String(id) !== String(testId));
  
  // Overwrite the execution array
  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  
  // Delete the individual property
  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${testId}\`, {
     method: 'DELETE'
  });
  
  return { success: true };
});`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched removeTestFromCycle");
} else {
    console.error("Could not find target in removeTestFromCycle");
}
