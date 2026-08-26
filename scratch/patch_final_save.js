const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix missing error handling and 429 retry on execution array PUT (in all endpoints)

const addExecutionRetry = (functionName) => {
    const target = `    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });`;

    const replacement = `    let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(testIds)
    });
    if (exRes.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(testIds)
        });
    }
    if (!exRes.ok) {
        const errText = await exRes.text();
        throw new Error(\`Jira PUT execution failed with \${exRes.status}: \${errText}\`);
    }`;
    
    if (content.includes(target)) {
        content = content.replace(target, replacement);
        console.log("Patched execution PUT retry in " + functionName);
    } else {
        // addTestToCycle uses a slightly different indentation
        const target2 = `  await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });`;
        if (content.includes(target2)) {
            content = content.replace(target2, replacement.replace(/    /g, '  '));
            console.log("Patched execution PUT retry in addTestToCycle");
        }
    }
};

addExecutionRetry('bulk');
addExecutionRetry('multiple');

// 2. Fix the unconditional overwrite of exec_ properties to prevent status loss
const overwriteTarget = `           let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(t)
           });`;

const overwriteReplacement = `           // Solo escribir si NO existe para no sobreescribir el estatus de pruebas ya ejecutadas
           let checkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`);
           if (checkRes.status === 429) {
               await new Promise(r => setTimeout(r, 1000));
               checkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`);
           }
           let res;
           if (checkRes.status === 404) {
               res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(t)
               });
           } else {
               // Ya existe, simular respuesta ok
               res = { ok: true, status: 200, text: async () => "" };
           }`;

if (content.includes(overwriteTarget)) {
    content = content.replace(overwriteTarget, overwriteReplacement);
    console.log("Patched overwrite prevention in bulk/multiple");
}

const singleOverwriteTarget = `  let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(newTest)
  });`;

const singleOverwriteReplacement = `  let checkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`);
  let res;
  if (checkRes.status === 404) {
      res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(newTest)
      });
  } else {
      res = { ok: true, status: 200, text: async () => "" };
  }`;

if (content.includes(singleOverwriteTarget)) {
    content = content.replace(singleOverwriteTarget, singleOverwriteReplacement);
    console.log("Patched overwrite prevention in addTestToCycle");
}

fs.writeFileSync(path, content);
