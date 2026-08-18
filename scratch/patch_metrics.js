const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// The replacement logic for renderReportsTab and renderConfigTab is extensive.
// It's safer to extract the entire `renderReportsTab` function using regex and replace it.

const extractFunction = (code, funcName) => {
    const startStr = `const ${funcName} = () => {`;
    let startIndex = code.indexOf(startStr);
    if (startIndex === -1) {
        // try alternative signature
        const altStart = `function ${funcName}() {`;
        startIndex = code.indexOf(altStart);
        if(startIndex === -1) return null;
    }

    let bracketCount = 0;
    let endIndex = -1;

    for (let i = startIndex; i < code.length; i++) {
        if (code[i] === '{') bracketCount++;
        else if (code[i] === '}') {
            bracketCount--;
            if (bracketCount === 0) {
                endIndex = i;
                break;
            }
        }
    }

    if (endIndex !== -1) {
        return code.substring(startIndex, endIndex + 1);
    }
    return null;
};

const oldReports = extractFunction(code, 'renderReportsTab');
const oldConfig = extractFunction(code, 'renderConfigTab');

const newReports = `const renderReportsTab = () => {
    let filteredCycles = reportData.cycles || [];
    if (reportSelectedPlan) {
      filteredCycles = filteredCycles.filter(c => c.planId === reportSelectedPlan);
    }
    if (reportSelectedCycle) {
      filteredCycles = filteredCycles.filter(c => c.id === reportSelectedCycle);
    }

    let totalCases = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notRun = 0;
    let totalBugs = 0;
    let closedBugs = 0;
    
    // For new metrics
    const testerStats = {};
    const execTypeStats = {};
    const bugTimes = {};

    filteredCycles.forEach(cycle => {
      if(cycle.execution) {
        cycle.execution.forEach(ex => {
          totalCases++;
          if (ex.status === 'Passed') passed++;
          else if (ex.status === 'Failed') failed++;
          else if (ex.status === 'Blocked') blocked++;
          else notRun++;
          
          // Tester stats
          const tester = ex.executedBy || 'Sin asignar';
          if (!testerStats[tester]) testerStats[tester] = { Passed: 0, Failed: 0, Blocked: 0, 'Not Run': 0, total: 0 };
          testerStats[tester][ex.status]++;
          testerStats[tester].total++;
          
          // Exec Type stats
          // Assuming we look for 'Manual' vs 'Automated' in a field, but we don't have it natively in standard.
          // Let's use 'executionType' if it exists, otherwise assume 'Manual' for now or pull from rawFields.
          let execType = 'Manual';
          if (ex.rawFields && ex.rawFields.components && ex.rawFields.components.some(c => c.name.toLowerCase().includes('auto'))) {
              execType = 'Automated';
          } else if (ex.renderedFields && ex.renderedFields.customfield_10010) { 
              // Hypothetical automation field
              execType = 'Automated';
          }
          if (!execTypeStats[execType]) execTypeStats[execType] = { Passed: 0, Failed: 0, Blocked: 0, 'Not Run': 0, total: 0 };
          execTypeStats[execType][ex.status]++;
          execTypeStats[execType].total++;

          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            totalBugs += ex.linkedBugs.length;
            ex.linkedBugs.forEach(bug => {
              const s = (bug.status || '').toLowerCase();
              if (['done', 'closed', 'resolved', 'cerrada', 'cerrado', 'resuelta', 'resuelto', 'terminado'].includes(s)) closedBugs++;
              
              if (bug.timesSpent) {
                  for (const [state, hours] of Object.entries(bug.timesSpent)) {
                      if (!bugTimes[state]) bugTimes[state] = { totalHours: 0, count: 0 };
                      bugTimes[state].totalHours += hours;
                      bugTimes[state].count++;
                  }
              }
            });
          }
        });
      }
    });

    const coverageRate = totalCases > 0 ? Math.round(((totalCases - notRun) / totalCases) * 100) : 0;
    
    // Configuration toggles
    const conf = projectConfig || {};
    const showProgreso = conf.showProgreso !== false;
    const showTesterStats = conf.showTesterStats !== false;
    const showExecTypeStats = conf.showExecTypeStats !== false;
    const showBugTimes = conf.showBugTimes !== false;

  const handleCopyReportToClipboard = async () => {
    const context = await view.getContext();
    const baseUrl = context.siteUrl;
    let tableRows = '';
    
    // Generar las filas de la tabla de defectos
    filteredCycles.forEach(cycle => {
      if (cycle.execution) {
        cycle.execution.forEach(ex => {
          if (ex.linkedBugs && ex.linkedBugs.length > 0) {
            ex.linkedBugs.forEach(bug => {
              tableRows += \`
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="\${baseUrl}/browse/\${bug.key}">\${bug.key}</a></td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.summary || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.severity || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.status || 'Desconocido'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.assignee || 'Sin asignar'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">\${bug.resolution || 'Unresolved'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;"><a href="\${baseUrl}/browse/\${ex.key}">\${ex.key}</a></td>
                </tr>
              \`;
            });
          }
        });
      }
    });

    const htmlTemplate = \`
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}</h2>
        <p>A continuación se presenta el resumen ejecutivo de la ejecución de pruebas.</p>
        
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Total Casos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #22A06B;">Pasados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left; color: #E34935;">Fallados</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Defectos</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Cobertura</th>
          </tr>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">\${totalCases}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${passed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${failed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${totalBugs} (Cerrados: \${closedBugs})</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${coverageRate}%</td>
          </tr>
        </table>
        
        <h3>Detalle de Defectos Reportados</h3>
        \${tableRows ? \`<table style="border-collapse: collapse; width: 100%; font-size: 12px;">
          <tr style="background-color: #f4f5f7;">
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Id del bug</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Descripción</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Severidad</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Estado</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Responsable</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Resolución</th>
            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Link al caso</th>
          </tr>
          \${tableRows}
        </table>\` : '<p>No hay defectos asociados en este reporte.</p>'}
      </div>
    \`;

    const container = document.createElement('div');
    container.innerHTML = htmlTemplate;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      document.execCommand('copy');
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);
      
      let subject = "Resumen de Pruebas";
      if (reportSelectedCycle) {
        subject += ": " + filteredCycles[0]?.summary;
      }
      router.open(\`https://mail.google.com/mail/?view=cm&fs=1&su=\${subject}\`);
    } catch (err) {
      console.error("Hubo un error al copiar la plantilla", err);
      alert("Hubo un error al copiar la plantilla.");
    } finally {
      selection.removeAllRanges();
      document.body.removeChild(container);
    }
  };

    return (
      <div className="tab-layout">
        <div className="tab-sidebar">
          <h3>Report Options</h3>
          
          <div className="form-group">
            <label>Filtrar por Plan</label>
            <select value={reportSelectedPlan} onChange={(e) => {
              setReportSelectedPlan(e.target.value);
              setReportSelectedCycle('');
            }}>
              <option value="">Todos los Planes</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
            </select>
          </div>
          
          <div className="form-group">
            <label>Filtrar por Ciclo</label>
            <select value={reportSelectedCycle} onChange={(e) => setReportSelectedCycle(e.target.value)}>
              <option value="">Todos los Ciclos</option>
              {cycles.filter(c => !reportSelectedPlan || c.planId === reportSelectedPlan).map(c => 
                <option key={c.id} value={c.id}>{c.summary}</option>
              )}
            </select>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              onClick={handleCopyReportToClipboard}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Enviar Reporte de Estatus
            </button>
            <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center'}}>
              Copia una plantilla enriquecida al portapapeles y abre Gmail.
            </p>
          </div>
        </div>
        
        <div className="tab-content" style={{ background: 'var(--bg-main)' }}>
          <div className="kpi-container">
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--text-secondary)' }}>TOTAL CASOS</div>
              <div className="kpi-value">{totalCases}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--success-color)' }}>PASADOS</div>
              <div className="kpi-value">{passed}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--danger-color)' }}>FALLADOS</div>
              <div className="kpi-value">{failed}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span role="img" aria-label="bug">🐞</span>
                DEFECTOS
              </div>
              <div className="kpi-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ lineHeight: '1' }}>{totalBugs}</span>
                {totalBugs > 0 && <span style={{fontSize: '0.9rem', display: 'block', color: 'var(--success-color)', marginTop: '0.5rem', lineHeight: '1'}}>Cerrados = {closedBugs}</span>}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--brand-color, #0C66E4)' }}>COBERTURA</div>
              <div className="kpi-value">{coverageRate}%</div>
            </div>
          </div>

          {showProgreso && (
            <div className="chart-card" style={{ gridColumn: '1 / -1' }}>
               <h3>Progreso por Ciclo de Pruebas</h3>
               <div className="bar-chart-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
                 {filteredCycles.length === 0 ? (
                   <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>No hay ciclos para mostrar.</div>
                 ) : (
                   filteredCycles.map(cycle => {
                     let cPassed = 0, cFailed = 0, cBlocked = 0, cNotRun = 0;
                     if (cycle.execution) {
                       cycle.execution.forEach(ex => {
                         if (ex.status === 'Passed') cPassed++;
                         else if (ex.status === 'Failed') cFailed++;
                         else if (ex.status === 'Blocked') cBlocked++;
                         else cNotRun++;
                       });
                     }
                     const cTotal = cPassed + cFailed + cBlocked + cNotRun;
                     
                     return (
                       <div className="bar-row" key={cycle.id}>
                         <div className="bar-label" title={cycle.summary}>
                           <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{cycle.summary}</span>
                           <span style={{ color: 'var(--text-secondary)' }}>{cTotal} casos</span>
                         </div>
                         <div className="bar-track">
                           {cTotal > 0 ? (
                             <>
                               {cPassed > 0 && <div className="bar-segment" style={{ width: \`\${(cPassed/cTotal)*100}%\`, background: 'var(--success-color)' }} title={\`Passed: \${cPassed}\`}></div>}
                               {cFailed > 0 && <div className="bar-segment" style={{ width: \`\${(cFailed/cTotal)*100}%\`, background: 'var(--danger-color)' }} title={\`Failed: \${cFailed}\`}></div>}
                               {cBlocked > 0 && <div className="bar-segment" style={{ width: \`\${(cBlocked/cTotal)*100}%\`, background: 'var(--warning-color)' }} title={\`Blocked: \${cBlocked}\`}></div>}
                               {cNotRun > 0 && <div className="bar-segment" style={{ width: \`\${(cNotRun/cTotal)*100}%\`, background: 'var(--brand-color)' }} title={\`Not Run: \${cNotRun}\`}></div>}
                             </>
                           ) : (
                             <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin casos</div>
                           )}
                         </div>
                       </div>
                     );
                   })
                 )}
               </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            {showTesterStats && (
              <div className="chart-card">
                 <h3>Casos por Tester</h3>
                 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                   <thead>
                     <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                       <th style={{ padding: '0.5rem', textAlign: 'left' }}>Tester</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--success-color)' }}>Passed</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--danger-color)' }}>Failed</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--warning-color)' }}>Blocked</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center' }}>Total</th>
                     </tr>
                   </thead>
                   <tbody>
                     {Object.entries(testerStats).map(([tester, stats]) => (
                        <tr key={tester} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{tester}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Passed}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Failed}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Blocked}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 'bold' }}>{stats.total}</td>
                        </tr>
                     ))}
                   </tbody>
                 </table>
              </div>
            )}

            {showExecTypeStats && (
              <div className="chart-card">
                 <h3>Casos por Tipo de Ejecución</h3>
                 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                   <thead>
                     <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                       <th style={{ padding: '0.5rem', textAlign: 'left' }}>Tipo</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--success-color)' }}>Passed</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--danger-color)' }}>Failed</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--warning-color)' }}>Blocked</th>
                       <th style={{ padding: '0.5rem', textAlign: 'center' }}>Total</th>
                     </tr>
                   </thead>
                   <tbody>
                     {Object.entries(execTypeStats).map(([type, stats]) => (
                        <tr key={type} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{type}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Passed}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Failed}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{stats.Blocked}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 'bold' }}>{stats.total}</td>
                        </tr>
                     ))}
                   </tbody>
                 </table>
              </div>
            )}
          </div>

          {showBugTimes && (
            <div className="chart-card" style={{ marginTop: '1rem' }}>
               <h3>Resolución de Bugs (Tiempos Promedio en Estado)</h3>
               <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Calculado solo en horario laboral (L-J 7am-6pm, V 7am-1pm) excluyendo feriados MX.</p>
               <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                 <thead>
                   <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '2px solid var(--ds-border)' }}>
                     <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado del Defecto</th>
                     <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total de Horas</th>
                     <th style={{ padding: '0.5rem', textAlign: 'right' }}>Promedio (Horas por Bug)</th>
                   </tr>
                 </thead>
                 <tbody>
                   {Object.keys(bugTimes).length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No hay datos suficientes en el historial de los bugs.</td></tr>
                   ) : (
                      Object.entries(bugTimes).sort((a,b) => b[1].totalHours - a[1].totalHours).map(([state, data]) => {
                        const avg = data.count > 0 ? (data.totalHours / data.count) : 0;
                        return (
                          <tr key={state} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                            <td style={{ padding: '0.5rem', textTransform: 'capitalize', fontWeight: '500' }}>{state}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>{data.totalHours.toFixed(1)} hrs</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>{avg.toFixed(1)} hrs</td>
                          </tr>
                        );
                      })
                   )}
                 </tbody>
               </table>
            </div>
          )}

          {filteredCycles.some(c => c.execution && c.execution.some(ex => ex.linkedBugs && ex.linkedBugs.length > 0)) ? (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem', overflowX: 'auto', marginBottom: '1rem' }}>
              <h3>Detalle de Defectos Reportados</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
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
              </table>
            </div>
          ) : null}
          
        </div>
      </div>
    );
  };`;

const newConfig = `const renderConfigTab = () => (
    <div className="tab-layout">
      <div className="tab-content" style={{ maxWidth: '800px', margin: '0 auto', background: 'var(--bg-main)' }}>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)' }}>Configuración del Proyecto</h2>
        
        <div className="chart-card">
          <h3 style={{ borderBottom: '1px solid var(--ds-border)', paddingBottom: '0.5rem' }}>Mapeo de Tipos de Issue</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Alinea la aplicación con tu esquema de Jira. ¿Cómo se llaman los siguientes conceptos en tu proyecto?
          </p>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Plan</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testPlanType || 'Test Plan'}
              onChange={e => setProjectConfig({...projectConfig, testPlanType: e.target.value})}
              placeholder="Ej: Test Plan"
            />
          </div>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Cycle</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testCycleType || 'Test Cycle'}
              onChange={e => setProjectConfig({...projectConfig, testCycleType: e.target.value})}
              placeholder="Ej: Test Cycle"
            />
          </div>

          <div className="form-group">
            <label>Tipo de issue para <strong>Test Case</strong></label>
            <input 
              type="text" 
              className="form-control"
              value={projectConfig.testCaseType || 'Test Case'}
              onChange={e => setProjectConfig({...projectConfig, testCaseType: e.target.value})}
              placeholder="Ej: Test Case"
            />
          </div>
        </div>

        <div className="chart-card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ borderBottom: '1px solid var(--ds-border)', paddingBottom: '0.5rem' }}>Widgets del Tablero de Reportes</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Selecciona qué métricas y gráficas estarán visibles en la pestaña de Reportes. Los contadores principales y la tabla de defectos son fijos.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showProgreso !== false}
                 onChange={e => setProjectConfig({...projectConfig, showProgreso: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Progreso por Ciclo de Pruebas</span>
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showTesterStats !== false}
                 onChange={e => setProjectConfig({...projectConfig, showTesterStats: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Casos por Tester</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showExecTypeStats !== false}
                 onChange={e => setProjectConfig({...projectConfig, showExecTypeStats: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Casos por Tipo de Ejecución (Manual/Auto)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
               <input 
                 type="checkbox" 
                 checked={projectConfig.showBugTimes !== false}
                 onChange={e => setProjectConfig({...projectConfig, showBugTimes: e.target.checked})}
                 style={{ width: '1.2rem', height: '1.2rem' }}
               />
               <span style={{ fontWeight: '500' }}>Mostrar Tiempo de Resolución de Defectos (Horas Laborales)</span>
            </label>
          </div>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            className="btn btn-primary" 
            onClick={saveProjectConfig}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </div>
    </div>
  );`;

code = code.replace(oldReports, newReports);
code = code.replace(oldConfig, newConfig);

fs.writeFileSync('static/hello-world/src/App.js', code);
