const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

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
  }`;

const replacementSingle = `  const newTest = {
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
    fs.writeFileSync(path, content);
    console.log("Patched addTestToCycle to always write");
} else {
    console.error("Could not find targetSingle in addTestToCycle");
}
