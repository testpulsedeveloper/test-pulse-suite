const fs = require('fs');
let code = fs.readFileSync('src/index.js', 'utf8');

const oldBackend = `  const cycles = await Promise.all((data.issues || []).map(async issue => {
    const planId = issue.properties?.['testops-plan-link']?.planId || null;
    const execution = await getExecutionData(issue.id);
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution: execution || []
    };
  }));

  return { cycles };`;

const newBackend = `  const cycles = await Promise.all((data.issues || []).map(async issue => {
    const planId = issue.properties?.['testops-plan-link']?.planId || null;
    const execution = await getExecutionData(issue.id);
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution: execution || []
    };
  }));

  // Fetch live bug details
  const allBugKeys = new Set();
  cycles.forEach(c => {
     c.execution?.forEach(ex => {
        ex.linkedBugs?.forEach(b => {
           if (b.key) allBugKeys.add(b.key);
        });
     });
  });

  if (allBugKeys.size > 0) {
     try {
       const jql = \`issuekey IN (\${Array.from(allBugKeys).join(',')})\`;
       const resp = await api.asUser().requestJira(route\`/rest/api/3/search\`, {
         method: 'POST',
         headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
         body: JSON.stringify({
           jql,
           fields: ['summary','status','assignee','resolution','customfield_10004','priority']
         })
       });
       const result = await resp.json();
       const bugMap = {};
       if (result.issues) {
         result.issues.forEach(i => {
            bugMap[i.key] = {
               summary: i.fields?.summary,
               status: i.fields?.status?.name,
               assignee: i.fields?.assignee?.displayName || 'Sin asignar',
               resolution: i.fields?.resolution?.name || 'Unresolved',
               severity: i.fields?.customfield_10004 || i.fields?.priority?.name || 'N/A'
            };
         });
         cycles.forEach(c => {
           c.execution?.forEach(ex => {
              ex.linkedBugs?.forEach(b => {
                 if (bugMap[b.key]) {
                    Object.assign(b, bugMap[b.key]);
                 }
              });
           });
         });
       }
     } catch (err) {
       console.error('Failed to fetch live bug details:', err);
     }
  }

  return { cycles };`;

code = code.replace(oldBackend, newBackend);
fs.writeFileSync('src/index.js', code);
