const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `const setExecutionData = async (cycleId, data) => {
  const testIds = data.map(t => t.id);
  
  await Promise.all(data.map(t => 
     api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
       method: 'PUT',
       headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
       body: JSON.stringify(t)
     })
  ));
  
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });`;

const replacement = `const setExecutionData = async (cycleId, data) => {
  const testIds = data.map(t => t.id);
  
  // Procesar en chunks de 15 para evitar HTTP 429
  const CHUNK_SIZE = 15;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(t => 
         api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
           method: 'PUT',
           headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
           body: JSON.stringify(t)
         })
      ));
  }
  
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
    method: 'PUT',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(testIds)
  });`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched setExecutionData with chunking");
} else {
    console.error("Could not find target in setExecutionData");
}
