const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Inject live bug fetching inside loadReportData
const oldLoadReportData = `
  const loadReportData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    const data = await invoke('getExecutionReport', { projectId: selectedProjectId, config: projectConfig });
    setReportData(data || { cycles: [] });
    setLoading(false);
  };
`;

const newLoadReportData = `
  const loadReportData = async () => {
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
  };
`;

code = code.replace(oldLoadReportData.trim(), newLoadReportData.trim());

// 2. Fix bug table in Reports
const oldTableHtml = `              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Bug Key</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descripción</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Severidad</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Caso Asociado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCycles.flatMap(cycle => 
                    (cycle.execution || []).flatMap(ex => 
                      (ex.linkedBugs || []).map(bug => (
                        <tr key={bug.id || bug.key} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '0.5rem' }}><a href={\`/browse/\${bug.key}\`} target="_blank" rel="noreferrer">{bug.key}</a></td>
                          <td style={{ padding: '0.5rem' }}>{bug.summary || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>{bug.severity || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', backgroundColor: bug.resolution ? 'var(--success-bg)' : 'var(--danger-bg)', color: bug.resolution ? 'var(--success-color)' : 'var(--danger-color)' }}>
                              {bug.status || 'Desconocido'}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{ex.summary || ex.key}</td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>`;

const newTableHtml = `              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Id del bug</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descripción</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Severidad</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Responsable</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Resolución</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Link al caso</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCycles.flatMap(cycle => 
                    (cycle.execution || []).flatMap(ex => 
                      (ex.linkedBugs || []).map((bug, i) => (
                        <tr key={bug.key + '-' + i} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '0.5rem' }}>
                             <a href="#" onClick={(e) => { e.preventDefault(); router.open(\`/browse/\${bug.key}\`); }}>{bug.key}</a>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{bug.summary || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>{bug.severity || 'N/A'}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', backgroundColor: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-bg)' : 'var(--danger-bg)', color: (bug.resolution && bug.resolution !== 'Unresolved') ? 'var(--success-color)' : 'var(--danger-color)' }}>
                              {bug.status || 'Desconocido'}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem' }}>{bug.assignee || 'Sin asignar'}</td>
                          <td style={{ padding: '0.5rem' }}>{bug.resolution || 'Unresolved'}</td>
                          <td style={{ padding: '0.5rem' }}>
                             <a href="#" onClick={(e) => { e.preventDefault(); router.open(\`/browse/\${ex.key}\`); }}>{ex.key}</a>
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>`;

code = code.replace(oldTableHtml, newTableHtml);

// 3. Fix the missing alert inside handleCopyReportToClipboard
const routerOpenCode = "router.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}`);";
const alertCode = `const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);
      ` + routerOpenCode;

code = code.replace(routerOpenCode, alertCode);

// 4. Update the handleCopyReportToClipboard internal HTML template for columns
const oldHtmlTable = `          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Bug Key</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Caso Asociado</th>
          </tr>`;

const newHtmlTable = `          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Link al caso</th>
          </tr>`;

code = code.replace(oldHtmlTable, newHtmlTable);

const oldRowTemplate = `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.key}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${ex.summary || 'Caso de Prueba'}</td>
                </tr>
`;

const newRowTemplate = `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.key}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${ex.key}</td>
                </tr>
`;

code = code.replace(oldRowTemplate.trim(), newRowTemplate.trim());

// Write back
fs.writeFileSync('static/hello-world/src/App.js', code);
