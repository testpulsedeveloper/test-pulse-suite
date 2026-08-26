const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const targetBulk = `    // Procesar los nuevos concurrentemente en bloques de 10 para mayor velocidad sin timeout
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(t => 
           api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(t)
           })
        ));
    }`;

const replacementBulk = `    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (t) => {
           let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(t)
           });
           if (res.status === 429) {
               await new Promise(r => setTimeout(r, 2000));
               res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(t)
               });
           }
           if (!res.ok) {
               // Si falla, lo quitamos de testIds para que se pueda reintentar luego
               testIds = testIds.filter(id => id !== t.id);
           }
        }));
    }`;

if (content.includes(targetBulk)) {
    content = content.replace(targetBulk, replacementBulk);
    console.log("Patched addBulkTestsToCycle");
}

const targetMultiple = `  if (changed) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(nt => 
           api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(nt)
           })
        ));
    }`;

const replacementMultiple = `  if (changed) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < newTests.length; i += CHUNK_SIZE) {
        const chunk = newTests.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (nt) => {
           let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
             method: 'PUT',
             headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
             body: JSON.stringify(nt)
           });
           if (res.status === 429) {
               await new Promise(r => setTimeout(r, 2000));
               res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${nt.id}\`, {
                 method: 'PUT',
                 headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                 body: JSON.stringify(nt)
               });
           }
           if (!res.ok) {
               testIds = testIds.filter(id => id !== nt.id);
           }
        }));
    }`;

if (content.includes(targetMultiple)) {
    content = content.replace(targetMultiple, replacementMultiple);
    console.log("Patched addMultipleTestsToCycle");
}

const targetSingle = `    await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(newTest)
    });
    
    testIds.push(testCase.id);`;

const replacementSingle = `    let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${newTest.id}\`, {
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
    }`;

if (content.includes(targetSingle)) {
    content = content.replace(targetSingle, replacementSingle);
    console.log("Patched addTestToCycle");
}

fs.writeFileSync(path, content);
