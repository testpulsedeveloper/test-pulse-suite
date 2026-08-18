const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldLoadReportData = `  const loadReportData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const data = await invoke('getExecutionReport', { projectId: selectedProjectId, config: projectConfig });
    
    if (data && data.cycles) {
      const allBugKeys = new Set();
      data.cycles.forEach(c => {
         c.execution?.forEach(ex => {
            ex.linkedBugs?.forEach(b => allBugKeys.add(b.key));
         });
      });

      if (allBugKeys.size > 0) {
         try {
           const jql = \`issuekey IN (\${Array.from(allBugKeys).join(',')})\`;
           const resp = await requestJira(\`/rest/api/3/search?jql=\${encodeURIComponent(jql)}&fields=summary,status,assignee,resolution,customfield_10004,priority\`);
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
             data.cycles.forEach(c => {
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
    }

    setReportData(data || { cycles: [] });
    setLoading(false);
  };`;

const newLoadReportData = `  const loadReportData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const data = await invoke('getExecutionReport', { projectId: selectedProjectId, config: projectConfig });
    setReportData(data || { cycles: [] });
    setLoading(false);
  };`;

code = code.replace(oldLoadReportData, newLoadReportData);
fs.writeFileSync('static/hello-world/src/App.js', code);
