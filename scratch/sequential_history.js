const fs = require('fs');
let indexContent = fs.readFileSync('src/index.js', 'utf8');

// Replace Promise.all with sequential loop
const searchStr = `    // For each cycle, read its execution data
    await Promise.all((data.issues || []).map(async (cycle) => {
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
    }));`;

const replacement = `    // For each cycle, read its execution data sequentially to avoid rate limits
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

if (indexContent.includes(searchStr)) {
  indexContent = indexContent.replace(searchStr, replacement);
  fs.writeFileSync('src/index.js', indexContent);
  console.log("Made history fetching sequential.");
} else {
  console.log("Could not find the Promise.all block.");
}
