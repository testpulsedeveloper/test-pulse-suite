const fs = require('fs');

let indexContent = fs.readFileSync('src/index.js', 'utf8');

const newResolver = `
resolver.define('getTestCaseHistory', async ({ payload }) => {
  try {
    const { testId, projectId, config } = payload;
    const cycleType = config?.testCycleType || 'Test Cycle';
    const projectJql = projectId ? \`project = \${projectId} AND \` : '';
    
    // Fetch all test cycles
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
    
    // For each cycle, read its execution data
    await Promise.all((data.issues || []).map(async (cycle) => {
      const execRes = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycle.id}/properties/execution\`);
      if (execRes.status === 200) {
        const execData = await execRes.json();
        const value = execData.value || [];
        const testExec = value.find(t => t.id === testId);
        if (testExec) {
          history.push({
            cycleId: cycle.id,
            cycleKey: cycle.key,
            cycleSummary: cycle.fields.summary,
            status: testExec.status,
            executedBy: testExec.executedBy,
            iterations: testExec.iterations || [],
            comment: testExec.comment
          });
        }
      }
    }));
    
    return history;
  } catch (e) {
    console.error("getTestCaseHistory error:", e);
    return [];
  }
});
`;

if (!indexContent.includes("getTestCaseHistory")) {
  indexContent = indexContent.replace(/export const handler = resolver\.getHandlers\(\);/m, newResolver + "\nexport const handler = resolver.getHandlers();");
  fs.writeFileSync('src/index.js', indexContent);
  console.log("Added getTestCaseHistory to index.js");
}
