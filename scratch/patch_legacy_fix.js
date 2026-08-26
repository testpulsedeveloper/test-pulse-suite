const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  if (typeof value[0] === 'object') {
     // LEGACY MIGRATION: Auto-migrate objects to individual properties
     console.log('Migrating legacy execution data to per-test storage');
     const testIds = value.map(t => t.id);
     
     await Promise.all(value.map(t => 
        api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(t)
        })
     ));
     
     await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(testIds)
     });
     
     return value;
  }`;

const replacement = `  if (typeof value[0] === 'object') {
     console.log('Migrating legacy execution data to per-test storage');
     const testIds = value.map(t => t.id);
     
     const CHUNK_SIZE = 10;
     for (let i = 0; i < value.length; i += CHUNK_SIZE) {
         const chunk = value.slice(i, i + CHUNK_SIZE);
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
         }));
     }
     
     await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
          method: 'PUT',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(testIds)
     });
     
     return value;
  }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched legacy migration to avoid data loss");
} else {
    console.error("Could not find target in legacy migration");
}
