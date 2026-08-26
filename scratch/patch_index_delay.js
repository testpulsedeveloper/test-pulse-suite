const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  // Si las propiedades están vacías (por algún bug de Jira con el *all), hacemos un fallback 
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

const replacement = `  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
  // Note: JQL search indexing can be delayed. If a test was just added, it might be in 'value' (fetched directly)
  // but missing from the JQL search results.
  let mergedProps = { ...properties };
  
  // If JQL search entirely failed to return properties (Jira bug with *all) OR if some properties are missing due to indexing delay:
  const missingIds = value.filter(id => !mergedProps[\`exec_\${id}\`]);
  
  if (missingIds.length > 0) {
      console.log(\`Fetching \${missingIds.length} missing properties directly to bypass JQL index delay...\`);
      // Fetch each missing property directly (this hits the DB directly, bypassing JQL cache)
      const missingPropsPromises = missingIds.map(async (id) => {
          const res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
          if (res.ok) {
              const data = await res.json();
              return { key: \`exec_\${id}\`, value: data.value };
          }
          return null;
      });
      
      const resolvedMissing = await Promise.all(missingPropsPromises);
      resolvedMissing.forEach(prop => {
          if (prop) mergedProps[prop.key] = prop.value;
      });
  }
  
  const results = value.map(id => mergedProps[\`exec_\${id}\`]).filter(Boolean);
  
  return results;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData to bypass JQL index delay");
} else {
    console.error("Could not find getExecutionData target");
}
