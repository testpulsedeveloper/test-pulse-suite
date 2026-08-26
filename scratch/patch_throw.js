const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const targetBulk = `           if (!res.ok) {
               // Si falla, lo quitamos de testIds para que se pueda reintentar luego
               testIds = testIds.filter(id => id !== t.id);
           }`;

const replacementBulk = `           if (!res.ok) {
               const errText = await res.text();
               throw new Error(\`Jira PUT exec_\${t.id} failed with \${res.status}: \${errText}\`);
           }`;

if (content.includes(targetBulk)) {
    content = content.replace(targetBulk, replacementBulk);
    console.log("Patched addBulkTestsToCycle to throw on error");
}

const targetMultiple = `           if (!res.ok) {
               testIds = testIds.filter(id => id !== nt.id);
           }`;

const replacementMultiple = `           if (!res.ok) {
               const errText = await res.text();
               throw new Error(\`Jira PUT exec_\${nt.id} failed with \${res.status}: \${errText}\`);
           }`;

if (content.includes(targetMultiple)) {
    content = content.replace(targetMultiple, replacementMultiple);
    console.log("Patched addMultipleTestsToCycle to throw on error");
}

const targetSingle = `  if (res.ok) {
      if (!testIds.includes(testCase.id)) {
          testIds.push(testCase.id);
      }
      await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(testIds)
      });
  }
  return { success: true };`;

const replacementSingle = `  if (!res.ok) {
      const errText = await res.text();
      throw new Error(\`Jira PUT exec_\${newTest.id} failed with \${res.status}: \${errText}\`);
  }
  
  if (!testIds.includes(testCase.id)) {
      testIds.push(testCase.id);
  }
  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });
  
  return { success: true };`;

if (content.includes(targetSingle)) {
    content = content.replace(targetSingle, replacementSingle);
    console.log("Patched addTestToCycle to throw on error");
}

fs.writeFileSync(path, content);
