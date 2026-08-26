const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// Modify addBulkTestsToCycle to return historical statuses
const bulkTarget = `           if (checkRes.status === 404) {
               res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(t)
               });
           } else {
               // Ya existe, simular respuesta ok
               res = { ok: true, status: 200, text: async () => "" };
           }`;

const bulkReplace = `           if (checkRes.status === 404) {
               res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
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
           }`;

content = content.replace(bulkTarget, bulkReplace);

const bulkReturnTarget = `  return { success: true };
});`;

const bulkReturnReplace = `  // Return the newly added items with their historical data
  return { success: true, addedTests: newTests };
});`;

content = content.replace(bulkReturnTarget, bulkReturnReplace);

// Same for addTestToCycle
const singleTarget = `  if (checkRes.status === 404) {
      res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(newTest)
      });
  } else {
      res = { ok: true, status: 200, text: async () => "" };
  }`;

const singleReplace = `  if (checkRes.status === 404) {
      res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
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
  }`;

content = content.replace(singleTarget, singleReplace);

const singleReturnTarget = `  return { success: true };
});

resolver.define('addMultipleTestsToCycle'`;

const singleReturnReplace = `  return { success: true, addedTest: newTest };
});

resolver.define('addMultipleTestsToCycle'`;

content = content.replace(singleReturnTarget, singleReturnReplace);

fs.writeFileSync(path, content);
console.log("Patched src/index.js to return historical statuses");
