const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = `  // Load execution data from memory directly using the properties fetched in O(1)
  const cycles = allIssues.map(issue => {
    const properties = issue.properties || {};
    const planId = properties['testops-plan-link']?.planId || null;
    
    // Parse execution data locally instead of making N network requests
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else {
           execution = executionIds.map(id => properties[\`exec_\${id}\`]).filter(Boolean);
       }
    }
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution: execution || []
    };
  });`;

const newBlock = `  // Load execution data and auto-heal old formats
  const cycles = [];
  for (const issue of allIssues) {
    const properties = issue.properties || {};
    const planId = properties['testops-plan-link']?.planId || null;
    
    const executionIds = properties['execution'] || [];
    let execution = [];
    if (Array.isArray(executionIds)) {
       if (executionIds.length > 0 && typeof executionIds[0] === 'object') {
           execution = executionIds;
       } else if (executionIds.length > 0 && typeof executionIds[0] !== 'object') {
           console.log(\`Auto-healing lightweight index for cycle \${issue.key}\`);
           const fullData = await getExecutionData(issue.id);
           execution = fullData.map(ex => ({ id: String(ex.id), status: ex.status, linkedBugs: ex.linkedBugs || [] }));
           await api.asUser().requestJira(route\`/rest/api/3/issue/\${issue.id}/properties/execution\`, {
              method: 'PUT',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(execution)
           });
       }
    }
    
    cycles.push({
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution: execution || []
    });
  }`;

content = content.replace(oldBlock, newBlock);
fs.writeFileSync(path, content);
console.log("Patched getExecutionReport for auto-healing");
