const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const bulkData = await bulkRes.json();
  if (!bulkData.issues || bulkData.issues.length === 0) return [];
  
  const properties = bulkData.issues[0].properties || {};
  
  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
  const results = value.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
  
  return results;`;

const replacement = `  const bulkData = await bulkRes.json();
  if (!bulkData.issues || bulkData.issues.length === 0) return [];
  
  const properties = bulkData.issues[0].properties || {};
  
  // Si las propiedades están vacías (por algún bug de Jira con el *all), hacemos un fallback 
  // que descarga explícitamente los keys de este ciclo en O(1) usando los nombres explícitos
  if (Object.keys(properties).length === 0 && value.length > 0) {
      const explicitProps = value.map(id => \`exec_\${id}\`);
      const fallbackRes = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql: \`id = \${cycleId}\`,
          fields: ['id'],
          properties: explicitProps
        })
      });
      if (fallbackRes.ok) {
         const fallbackData = await fallbackRes.json();
         if (fallbackData.issues && fallbackData.issues.length > 0) {
            const fallbackProps = fallbackData.issues[0].properties || {};
            return value.map(id => fallbackProps[\`exec_\${id}\`]).filter(Boolean);
         }
      }
  }
  
  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
  const results = value.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
  
  return results;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData with Fallback!");
} else {
    console.error("Could not find target in index.js for fallback");
}
