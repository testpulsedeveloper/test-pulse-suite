const fs = require('fs');
let indexContent = fs.readFileSync('src/index.js', 'utf8');

const searchStr = `    // For each cycle, read its execution data sequentially to avoid rate limits
    for (const cycle of (data.issues || [])) {
      try {
        const execRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycle.id}/properties/execution\`);
        if (execRes.status === 200) {
          const execData = await execRes.json();
          const value = execData.value || [];
          const testExec = value.find(t => String(t.id) === String(testId));
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
    }`;

const replaceStr = `    // For each cycle, read its execution data sequentially to avoid rate limits
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
    }`;

if (indexContent.includes(searchStr)) {
  indexContent = indexContent.replace(searchStr, replaceStr);
  fs.writeFileSync('src/index.js', indexContent);
  console.log("Patched history data model");
} else {
  console.log("Could not find the search string in index.js");
}
