const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const fetchTarget = `  // NEW MODE: value is an array of test IDs ["10001", "10002"]
  const promises = value.map(async id => {
     const res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${id}\`);
     if (res.ok) {
         const obj = await res.json();
         return obj.value;
     }
     return null;
  });
  
  const results = await Promise.all(promises);
  return results.filter(r => r !== null);`;

const fetchReplacement = `  // NEW MODE: value is an array of test IDs ["10001", "10002"]
  // To avoid HTTP 429 Rate Limits, we fetch ALL exec_* properties in ONE single request!
  const bulkRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}?properties=exec_*\`);
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

if (content.includes(fetchTarget)) {
    content = content.replace(fetchTarget, fetchReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched getExecutionData to use BULK fetch!");
} else {
    console.error("Could not find fetchTarget in index.js");
}
