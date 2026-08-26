const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const targetBulk = `  const newTests = [];
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
  }`;

const replacementBulk = `  // OBTENER ESTADO REAL: 
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
        description: tc.description,
        status: 'Not Run',
        rawFields: tc.rawFields,
        renderedFields: tc.renderedFields
      };
      newTests.push(newTest);
      if (!testIds.includes(tc.id)) {
          testIds.push(tc.id);
      }
  }`;

if (content.includes(targetBulk)) {
    content = content.replace(targetBulk, replacementBulk);
    console.log("Patched addBulkTestsToCycle to always write");
}

const targetMultiple = `  let changed = false;
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
  }`;

const replacementMultiple = `  let changed = false;
  const newTests = [];
  for (const testCase of testCases) {
      newTests.push({
        id: testCase.id,
        key: testCase.key,
        summary: testCase.summary,
        description: testCase.description,
        status: 'Not Run',
        rawFields: testCase.rawFields,
        renderedFields: testCase.renderedFields
      });
      if (!testIds.includes(testCase.id)) {
          testIds.push(testCase.id);
      }
      changed = true;
  }`;

if (content.includes(targetMultiple)) {
    content = content.replace(targetMultiple, replacementMultiple);
    console.log("Patched addMultipleTestsToCycle to always write");
}

const targetSingle = `  if (!testIds.includes(testCase.id)) {
    const newTest = {
      id: testCase.id,
      key: testCase.key,
      summary: testCase.summary,
      description: testCase.description,
      status: 'Not Run',
      rawFields: testCase.rawFields,
      renderedFields: testCase.renderedFields
    };
    
    let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    });
    if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(newTest)
        });
    }
    
    if (res.ok) {
        testIds.push(testCase.id);
    }
    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
  }`;

const replacementSingle = `    const newTest = {
      id: testCase.id,
      key: testCase.key,
      summary: testCase.summary,
      description: testCase.description,
      status: 'Not Run',
      rawFields: testCase.rawFields,
      renderedFields: testCase.renderedFields
    };
    
    let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    });
    if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(newTest)
        });
    }
    
    if (res.ok) {
        if (!testIds.includes(testCase.id)) {
            testIds.push(testCase.id);
        }
        await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(testIds)
        });
    }`;

if (content.includes(targetSingle)) {
    content = content.replace(targetSingle, replacementSingle);
    console.log("Patched addTestToCycle to always write");
}

fs.writeFileSync(path, content);
