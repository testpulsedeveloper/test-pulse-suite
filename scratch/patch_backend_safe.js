const fs = require('fs');
let code = fs.readFileSync('src/index.js', 'utf8');

const oldBackend = `  if (allBugKeys.size > 0) {
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
  }`;

const newBackend = `  if (allBugKeys.size > 0) {
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
  }`;

code = code.replace(oldBackend, newBackend);
fs.writeFileSync('src/index.js', code);
