const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  // NEW MODE: value is an array of test IDs ["10001", "10002"]
  // To avoid HTTP 429 Rate Limits, we fetch ALL exec_* properties in ONE single request!
  const bulkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}?properties=*all\`);
  if (!bulkRes.ok) {
     console.error("Bulk property fetch failed with status: " + bulkRes.status);
     return [];
  }
  const bulkIssue = await bulkRes.json();
  const properties = bulkIssue.properties || {};
  
  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
  // We need to map them back to the exact order defined by 'value' (the test IDs array)
  const results = value.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
  
  return results;`;

const replacement = `  // NEW MODE: value is an array of test IDs ["10001", "10002"]
  // To avoid HTTP 429 Rate Limits, we fetch ALL properties in ONE single JQL request!
  const bulkRes = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: \`id = \${cycleId}\`,
      fields: ['id'],
      properties: ['*all']
    })
  });
  
  if (!bulkRes.ok) {
     console.error("Bulk property fetch failed with status: " + bulkRes.status);
     return [];
  }
  
  const bulkData = await bulkRes.json();
  if (!bulkData.issues || bulkData.issues.length === 0) return [];
  
  const properties = bulkData.issues[0].properties || {};
  
  // The 'properties' object will have keys like 'exec_10001', 'exec_10002', etc.
  const results = value.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
  
  return results;`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData to use JQL!");
} else {
    console.error("Could not find target in index.js");
}
