const fs = require('fs');

const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Replace getExecutionData
const oldFuncStart = 'const getExecutionData = async (cycleId) => {';
const oldFuncEnd = '  return results;\n};';
const startIndex = content.indexOf(oldFuncStart);
const endIndex = content.indexOf(oldFuncEnd) + oldFuncEnd.length;

const newFunc = `const getExecutionData = async (cycleId) => {
  const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution?t=\${Date.now()}\`);
  if (response.status === 404) return [];
  const data = await response.json();
  const value = data.value || [];
  
  if (value.length === 0) return [];
  
  const testIds = (typeof value[0] === 'object') ? value.map(t => String(t.id)) : value.map(String);
  if (!Array.isArray(testIds) || testIds.length === 0) return [];
  
  let mergedProps = {};
  const CHUNK_SIZE = 25;
  for (let i = 0; i < testIds.length; i += CHUNK_SIZE) {
      const chunk = testIds.slice(i, i + CHUNK_SIZE);
      const chunkPromises = chunk.map(async (id) => {
          let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}?t=\${Date.now()}\`);
          if (res.status === 429) {
              await new Promise(r => setTimeout(r, 2000));
              res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}?t=\${Date.now()}\`);
          }
          if (res.ok) {
              const data = await res.json();
              return { key: \`exec_\${id}\`, value: data.value };
          }
          return null;
      });
      const resolvedChunk = await Promise.all(chunkPromises);
      resolvedChunk.forEach(prop => {
          if (prop) mergedProps[prop.key] = prop.value;
      });
  }
  
  const results = testIds.map(id => mergedProps[\`exec_\${id}\`]).filter(Boolean);
  
  if (results.length === 0 && testIds.length > 0) {
      throw new Error("CRITICAL: getExecutionData failed to fetch properties for testIds. Preventing empty array return to avoid data loss.");
  }
  
  return results;
};

const updateLightweightIndex = async (cycleId, updateFn) => {
    let lightWeight = [];
    const response = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution?t=\${Date.now()}\`);
    if (response.status !== 404) {
        const data = await response.json();
        const value = data.value || [];
        if (value.length > 0 && typeof value[0] === 'object') {
            lightWeight = value;
        } else if (value.length > 0) {
            lightWeight = value.map(id => ({ id: String(id), status: 'Not Run', linkedBugs: [] }));
        }
    }
    
    lightWeight = updateFn(lightWeight);
    
    let exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(lightWeight)
    });
    if (exRes.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        exRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/execution\`, {
            method: 'PUT',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(lightWeight)
        });
    }
    if (!exRes.ok) {
        const errText = await exRes.text();
        console.error("Failed to update lightweight index:", errText);
    }
};`;

content = content.substring(0, startIndex) + newFunc + content.substring(endIndex);
fs.writeFileSync(path, content);
console.log("Rewrote getExecutionData and added updateLightweightIndex");
