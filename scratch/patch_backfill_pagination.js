const fs = require('fs');
let indexJs = fs.readFileSync('src/index.js', 'utf8');

const newBackfill = `resolver.define('backfillDescriptions', async ({ payload }) => {
  const { cycleId, testIds } = payload;
  if (!testIds || testIds.length === 0) return await getExecutionData(cycleId);

  let executionData = await getExecutionData(cycleId);

  try {
    const CHUNK_SIZE = 50;
    const descMap = {};
    const rawFieldsMap = {};
    const renderedFieldsMap = {};
    
    for (let i = 0; i < testIds.length; i += CHUNK_SIZE) {
        const chunk = testIds.slice(i, i + CHUNK_SIZE);
        const jql = \`id in (\${chunk.join(',')})\`;
        
        let response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ jql, fields: ['summary', 'description', 'environment'], expand: ['renderedFields'], maxResults: 100 })
        });
        
        if (response.status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            response = await api.asUser().requestJira(route\`/rest/api/3/search/jql\`, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ jql, fields: ['summary', 'description', 'environment'], expand: ['renderedFields'], maxResults: 100 })
            });
        }

        if (response.ok) {
            const data = await response.json();
            const issues = data.issues || [];
            for (const issue of issues) {
              descMap[issue.id] = issue.renderedFields?.description || issue.fields?.description || '';
              rawFieldsMap[issue.id] = issue.fields || {};
              renderedFieldsMap[issue.id] = issue.renderedFields || {};
            }
        } else {
            console.error("backfill chunk search failed:", response.status, await response.text());
        }
    }

    const updatedTests = [];
    executionData = executionData.map(t => {
       if (descMap[t.id] !== undefined) {
           const updated = { 
               ...t, 
               description: descMap[t.id], 
               expectedResult: renderedFieldsMap[t.id]?.environment || rawFieldsMap[t.id]?.environment || ''
           };
           updatedTests.push(updated);
           return updated;
       }
       return t;
    });

    const PUT_CHUNK = 10;
    for (let i = 0; i < updatedTests.length; i += PUT_CHUNK) {
        const chunk = updatedTests.slice(i, i + PUT_CHUNK);
        await Promise.all(chunk.map(async (t) => {
            let res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
               method: 'PUT',
               headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
               body: JSON.stringify(t)
            });
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 1500));
                res = await api.asUser().requestJira(route\`/rest/api/3/issue/\${cycleId}/properties/exec_\${t.id}\`, {
                   method: 'PUT',
                   headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                   body: JSON.stringify(t)
                });
            }
        }));
    }

  } catch (e) {
    console.error('backfillDescriptions error:', e);
  }

  return executionData;
});`;

// Extract existing backfillDescriptions to replace
const regex = /resolver\.define\('backfillDescriptions', async \(\{ payload \}\) => \{[\s\S]*?\n\}\);\n/g;
indexJs = indexJs.replace(regex, newBackfill + '\n');
fs.writeFileSync('src/index.js', indexJs);
console.log("Patched backfillDescriptions for pagination and performance");
