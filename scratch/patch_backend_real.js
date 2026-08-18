const fs = require('fs');
let code = fs.readFileSync('src/index.js', 'utf8');

const target = `  const cycles = await Promise.all((data.issues || []).map(async issue => {
    const planId = issue.properties?.['testops-plan-link']?.planId || null;
    const execution = await getExecutionData(issue.id);
    
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      planId,
      execution
    };
  }));
  
  return { cycles };`;

const replacement = `  const cycles = await Promise.all((data.issues || []).map(async issue => {
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
     const bugMap = {};
     await Promise.all(Array.from(allBugKeys).map(async key => {
         try {
            const resp = await api.asUser().requestJira(route\`/rest/api/3/issue/\${key}?fields=summary,status,assignee,resolution,customfield_10004,priority\`);
            if (resp.status === 200) {
               const i = await resp.json();
               bugMap[key] = {
                 summary: i.fields?.summary,
                 status: i.fields?.status?.name,
                 assignee: i.fields?.assignee?.displayName || 'Sin asignar',
                 resolution: i.fields?.resolution?.name || 'Unresolved',
                 severity: i.fields?.customfield_10004 || i.fields?.priority?.name || 'N/A'
               };
            }
         } catch (e) {
            console.error('Error fetching bug ' + key, e);
         }
     }));

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

  return { cycles };`;

if(code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/index.js', code);
    console.log("Patch applied!");
} else {
    console.log("Target not found!");
}
