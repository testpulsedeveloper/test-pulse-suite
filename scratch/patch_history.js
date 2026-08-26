const fs = require('fs');
const path = 'src/index.js';
let content = fs.readFileSync(path, 'utf8');

const target2 = `    // Fetch all test cycles
    const response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: \`\${projectJql}issuetype = "\${cycleType}" ORDER BY created DESC\`,
        fields: ['summary', 'created'],
        maxResults: 200
      })
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const history = [];
    
    // For each cycle, read its execution data sequentially to avoid rate limits
    for (const cycle of (data.issues || [])) {
      try {
        const execRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycle.id}/properties/execution\`);
        if (execRes.status === 200) {
          const execData = await execRes.json();
          const value = execData.value || [];
          
          let testExec = null;
          if (value.length > 0) {
            if (typeof value[0] === 'object') {
              // Legacy array of objects
              testExec = value.find(t => String(t.id) === String(testId));
            } else {
              // New array of IDs, check if testId is in the array
              if (value.some(id => String(id) === String(testId))) {
                const itemRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycle.id}/properties/exec_\${testId}\`);
                if (itemRes.status === 200) {
                  const itemData = await itemRes.json();
                  testExec = itemData.value;
                }
              }
            }
          }
          
          if (testExec) {
            history.push({
              cycleId: cycle.id,
              cycleKey: cycle.key,
              cycleSummary: cycle.fields.summary,
              status: testExec.status || 'Not Run',
              executedBy: testExec.executedBy,
              iterations: testExec.iterations || [],
              comment: testExec.comment
            });
          }
        }
      } catch (err) {
        console.error("Error fetching execution for cycle " + cycle.key, err);
      }
    }
    
    return history;`;

const replacement2 = `    // Fetch all test cycles AND the specific property for this test case in one go!
    const response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: \`\${projectJql}issuetype = "\${cycleType}" ORDER BY created DESC\`,
        fields: ['summary', 'created'],
        properties: [\`exec_\${testId}\`, 'execution'],
        maxResults: 200
      })
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const history = [];
    
    // For each cycle, read its execution data directly from memory
    for (const cycle of (data.issues || [])) {
      const properties = cycle.properties || {};
      
      let testExec = null;
      // 1. Try modern O(1) properties approach
      if (properties[\`exec_\${testId}\`]) {
        testExec = properties[\`exec_\${testId}\`];
      } 
      // 2. Fallback to legacy execution array if present in properties
      else if (Array.isArray(properties['execution']) && typeof properties['execution'][0] === 'object') {
        testExec = properties['execution'].find(t => String(t.id) === String(testId));
      }
      
      if (testExec) {
        history.push({
          cycleId: cycle.id,
          cycleKey: cycle.key,
          cycleSummary: cycle.fields.summary,
          status: testExec.status || 'Not Run',
          executedBy: testExec.executedBy,
          iterations: testExec.iterations || [],
          comment: testExec.comment
        });
      }
    }
    
    return history;`;

if (content.includes(target2)) {
    content = content.replace(target2, replacement2);
    fs.writeFileSync(path, content);
    console.log("Patched getTestCaseHistory!");
} else {
    console.error("Could not find targets for getTestCaseHistory");
}
