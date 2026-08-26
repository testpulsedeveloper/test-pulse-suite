const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const bulkData = await bulkRes.json();
  if (!bulkData.issues || bulkData.issues.length === 0) return [];
  
  const properties = bulkData.issues[0].properties || {};
  
  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
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
  }`;

const replacement = `  const bulkData = await bulkRes.json();
  
  const properties = (bulkData.issues && bulkData.issues.length > 0) ? (bulkData.issues[0].properties || {}) : {};
  
  let mergedProps = { ...properties };
  
  const missingIds = value.filter(id => !mergedProps[\`exec_\${id}\`]);
  
  if (missingIds.length > 0) {
      console.log(\`Fetching \${missingIds.length} missing properties directly to bypass JQL index delay...\`);
      
      const CHUNK_SIZE = 15;
      for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
          const chunk = missingIds.slice(i, i + CHUNK_SIZE);
          const chunkPromises = chunk.map(async (id) => {
              const res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
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
  }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData to handle empty JQL and chunk property fetching");
} else {
    console.error("Could not find target in getExecutionData");
}
