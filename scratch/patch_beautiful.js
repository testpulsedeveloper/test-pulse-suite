const fs = require('fs');

let oldReports = fs.readFileSync('scratch/original_reports2.js', 'utf8');

// The full beautiful renderReportsTab function
const newCode = `const renderReportsTab = () => {
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
    let totalResolutionHours = 0;
    let resolvedCount = 0;
    
    // Config
    const conf = projectConfig || {};
    const showProgreso = conf.showProgreso !== false;
    const showTesterStats = conf.showTesterStats !== false;
    const showExecTypeStats = conf.showExecTypeStats !== false;
    const showBugTimes = conf.showBugTimes !== false;

    // Custom metrics
    const testerStats = {};
    const bugTimes = {};
    const execStats = {
      manual: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 },
      auto: { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 }
    };

    filteredCycles.forEach(cycle => {
      if(cycle.execution) {
        cycle.execution.forEach(ex => {
          totalCases++;
          if (ex.status === 'Passed') passed++;
          else if (ex.status === 'Failed') failed++;
          else if (ex.status === 'Blocked') blocked++;
          else notRun++;
          
          // Exec Type
          let isAuto = false;
          if (ex.rawFields && ex.rawFields.components && ex.rawFields.components.some(c => c.name.toLowerCase().includes('auto'))) {
             isAuto = true;
          }
          const tc = testCases.find(t => t.id === ex.id);
          if (tc && executionTypeFieldId && tc.rawFields && tc.rawFields[executionTypeFieldId]) {
             const val = tc.rawFields[executionTypeFieldId];
             const strVal = typeof val === 'object' ? (val.value || val.name || '') : String(val);
             if (strVal.toLowerCase().includes('auto')) isAuto = true;
          }
          const stats = isAuto ? execStats.auto : execStats.manual;
          stats.total++;
          if (ex.status === 'Passed') stats.passed++;
          else if (ex.status === 'Failed') stats.failed++;
          else if (ex.status === 'Blocked') stats.blocked++;
          else stats.notRun++;

          // Tester
          const tester = ex.executedBy || 'Sin asignar';
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (ex.status === 'Passed') testerStats[tester].passed++;
          else if (ex.status === 'Failed') testerStats[tester].failed++;
          else if (ex.status === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;

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
                      
                      totalResolutionHours += hours;
                  }
                  resolvedCount++;
              }
            });
          }
        });
      }
    });

    const ejecutados = passed + failed;
    const successRate = ejecutados > 0 ? ((passed / ejecutados) * 100).toFixed(1) : 0;
    const allTotal = passed + failed + blocked + notRun;
    const coverageRate = allTotal > 0 ? (((passed + failed + blocked) / allTotal) * 100).toFixed(1) : 0;

    // Calc angles for donut
    const pPct = allTotal > 0 ? (passed / allTotal) * 100 : 0;
    const fPct = allTotal > 0 ? (failed / allTotal) * 100 : 0;
    const bPct = allTotal > 0 ? (blocked / allTotal) * 100 : 0;
    const nPct = allTotal > 0 ? (notRun / allTotal) * 100 : (allTotal === 0 ? 100 : 0);

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
            <td style="border: 1px solid #ddd; padding: 8px;">\${allTotal}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${passed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${failed}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${totalBugs} (Cerrados: \${closedBugs})</td>
            <td style="border: 1px solid #ddd; padding: 8px;">\${coverageRate}%</td>
          </tr>
        </table>
        
        <h3>Detalle de Defectos Reportados</h3>
        \${totalBugs > 0 ? \`
        <table style="border-collapse: collapse; width: 100%;">
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
        </table>
        \` : '<p>No se encontraron defectos en este ciclo.</p>'}
      </div>
    \`;

    try {
      const el = document.createElement('div');
      el.innerHTML = htmlTemplate;
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      
      document.execCommand('copy');
      
      selection.removeAllRanges();
      document.body.removeChild(el);

      const subject = encodeURIComponent(\`Resumen de Pruebas: \${reportSelectedCycle ? filteredCycles[0]?.summary : 'Todos los ciclos'}\`);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);
      router.open(\`https://mail.google.com/mail/?view=cm&fs=1&su=\${subject}\`);
    } catch(err) {
      console.error('Error al copiar:', err);
      alert("Hubo un error al copiar la plantilla.");
    }
  };

    return (
      <div className="tab-layout full-width" style={{padding: '2rem'}}>
        <div className="header" style={{marginBottom: '0'}}>
          <h1>Dashboard: Métricas de Calidad</h1>
          <button 
            className="btn-primary" 
            onClick={handleCopyReportToClipboard}
            style={{padding: '0.4rem 0.8rem', marginLeft: 'auto', marginRight: '1rem'}}
          >
            📋 Enviar reporte de Estatus
          </button>
          <div style={{display: 'flex', gap: '1rem'}}>
            <select 
              value={reportSelectedPlan} 
              onChange={e => { setReportSelectedPlan(e.target.value); setReportSelectedCycle(''); }}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">1. PROYECTO (Todos los Planes)</option>
              {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
            </select>
            <select 
              value={reportSelectedCycle} 
              onChange={e => setReportSelectedCycle(e.target.value)}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">2. VERSIÓN (Todos los Ciclos)</option>
              {(reportSelectedPlan ? (reportData.cycles || []).filter(c => c.planId === reportSelectedPlan) : (reportData.cycles || [])).map(c => 
                <option key={c.id} value={c.id}>{c.summary}</option>
              )}
            </select>
          </div>
        </div>

        <div className="dashboard-grid">
          
          <div className="kpi-row" style={{ gridColumn: '1 / -1', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="kpi-card">
              <div className="kpi-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E3F2FD" stroke="#1565C0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                TOTAL CASOS
              </div>
              <div className="kpi-value">{allTotal}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--success-color, #22A06B)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E8F5E9" stroke="#2E7D32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                PASADOS
              </div>
              <div className="kpi-value" style={{ color: 'var(--success-color, #22A06B)' }}>{passed}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--danger-color, #E34935)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFEBEE" stroke="#C62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                FALLADOS
              </div>
              <div className="kpi-value" style={{ color: 'var(--danger-color, #E34935)' }}>{failed}</div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-title" style={{ color: totalBugs > 0 ? 'var(--danger-color, #E34935)' : 'var(--text-secondary)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E34935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-3.9"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17.1c2.1.1 3.8 1.9 3.8 4"/></svg>
                DEFECTOS
              </div>
              <div className="kpi-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ lineHeight: '1' }}>{totalBugs}</span>
                {totalBugs > 0 && <span style={{fontSize: '0.9rem', display: 'block', color: 'var(--success-color)', marginTop: '0.5rem', lineHeight: '1'}}>Cerrados = {closedBugs}</span>}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title" style={{ color: 'var(--brand-color, #0C66E4)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#E3F2FD" stroke="#1565C0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                RESOLUCIÓN
              </div>
              <div className="kpi-value" style={{ fontSize: '1.5rem' }}>
                {resolvedCount > 0 ? \`\${(totalResolutionHours / resolvedCount).toFixed(1)} hrs\` : 'N/A'}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title" style={{ color: coverageRate > 50 ? 'var(--success-color, #22A06B)' : 'var(--warning-color, #F6C000)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFDE7" stroke="#FBC02D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                COBERTURA
              </div>
              <div className="kpi-value" style={{ color: coverageRate > 50 ? 'var(--success-color, #22A06B)' : 'var(--warning-color, #F6C000)' }}>{coverageRate}%</div>
            </div>

          </div>

          <div className="chart-card">
            <h3>Estado de pruebas</h3>
            <div className="donut-chart-container">
              <div className="donut-chart" style={{ background: \`conic-gradient(
                var(--success-color, #22A06B) 0% \${pPct}%,
                var(--danger-color, #E34935) \${pPct}% \${pPct + fPct}%,
                var(--warning-color, #F6C000) \${pPct + fPct}% \${pPct + fPct + bPct}%,
                var(--brand-color, #0C66E4) \${pPct + fPct + bPct}% 100%
              )\`}}>
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{successRate}%</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Éxito</div>
                </div>
              </div>
              
              <div className="legend">
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--success-color, #22A06B)' }}></div>
                  <span>Passed (\${pPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--danger-color, #E34935)' }}></div>
                  <span>Failed (\${fPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--warning-color, #F6C000)' }}></div>
                  <span>Blocked (\${bPct.toFixed(1)}%)</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--brand-color, #0C66E4)' }}></div>
                  <span>Not Run (\${nPct.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
          </div>

          {showExecTypeStats && (
            <div className="chart-card">
              <h3>Tipos de Ejecución (Manual vs Auto)</h3>
              <div className="bar-chart-container" style={{ marginTop: '1rem' }}>
                {['manual', 'auto'].map(type => {
                  const stats = execStats[type];
                  const label = type === 'auto' ? 'Automatizada' : 'Manual';
                  return (
                    <div className="bar-row" key={type}>
                      <div className="bar-label">
                        <span>{label}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{stats.total} casos</span>
                      </div>
                      <div className="bar-track">
                        {stats.total > 0 ? (
                          <>
                            {stats.passed > 0 && <div className="bar-segment" style={{ width: \`\${(stats.passed/stats.total)*100}%\`, background: 'var(--success-color, #22A06B)' }} title={\`Passed: \${stats.passed}\`}>{stats.passed > (stats.total*0.1) ? stats.passed : ''}</div>}
                            {stats.failed > 0 && <div className="bar-segment" style={{ width: \`\${(stats.failed/stats.total)*100}%\`, background: 'var(--danger-color, #E34935)' }} title={\`Failed: \${stats.failed}\`}>{stats.failed > (stats.total*0.1) ? stats.failed : ''}</div>}
                            {stats.blocked > 0 && <div className="bar-segment" style={{ width: \`\${(stats.blocked/stats.total)*100}%\`, background: 'var(--warning-color, #F6C000)' }} title={\`Blocked: \${stats.blocked}\`}>{stats.blocked > (stats.total*0.1) ? stats.blocked : ''}</div>}
                            {stats.notRun > 0 && <div className="bar-segment" style={{ width: \`\${(stats.notRun/stats.total)*100}%\`, background: 'var(--brand-color, #0C66E4)' }} title={\`Not Run: \${stats.notRun}\`}>{stats.notRun > (stats.total*0.1) ? stats.notRun : ''}</div>}
                          </>
                        ) : (
                           <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin casos</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success-color, #22A06B)'}}></div> Passed</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--danger-color, #E34935)'}}></div> Failed</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--warning-color, #F6C000)'}}></div> Blocked</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand-color, #0C66E4)'}}></div> Not Run</div>
              </div>
            </div>
          )}
          
          {showTesterStats && (
            <div className="chart-card">
              <h3>Estado por Tester</h3>
              <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(testerStats).map(([tester, stats]) => {
                  return (
                    <div className="bar-row" key={tester}>
                      <div className="bar-label">
                        <span>{tester}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{stats.total} casos</span>
                      </div>
                      <div className="bar-track">
                        {stats.total > 0 ? (
                          <>
                            {stats.passed > 0 && <div className="bar-segment" style={{ width: \`\${(stats.passed/stats.total)*100}%\`, background: 'var(--success-color, #22A06B)' }} title={\`Passed: \${stats.passed}\`}>{stats.passed > (stats.total*0.1) ? stats.passed : ''}</div>}
                            {stats.failed > 0 && <div className="bar-segment" style={{ width: \`\${(stats.failed/stats.total)*100}%\`, background: 'var(--danger-color, #E34935)' }} title={\`Failed: \${stats.failed}\`}>{stats.failed > (stats.total*0.1) ? stats.failed : ''}</div>}
                            {stats.blocked > 0 && <div className="bar-segment" style={{ width: \`\${(stats.blocked/stats.total)*100}%\`, background: 'var(--warning-color, #F6C000)' }} title={\`Blocked: \${stats.blocked}\`}>{stats.blocked > (stats.total*0.1) ? stats.blocked : ''}</div>}
                            {stats.notRun > 0 && <div className="bar-segment" style={{ width: \`\${(stats.notRun/stats.total)*100}%\`, background: 'var(--brand-color, #0C66E4)' }} title={\`Not Run: \${stats.notRun}\`}>{stats.notRun > (stats.total*0.1) ? stats.notRun : ''}</div>}
                          </>
                        ) : (
                           <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin casos</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success-color, #22A06B)'}}></div> Passed</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--danger-color, #E34935)'}}></div> Failed</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--warning-color, #F6C000)'}}></div> Blocked</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.3rem'}}><div style={{width: '10px', height: '10px', borderRadius: '2px', background: 'var(--brand-color, #0C66E4)'}}></div> Not Run</div>
              </div>
            </div>
          )}

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
                               {cPassed > 0 && <div className="bar-segment" style={{ width: \`\${(cPassed/cTotal)*100}%\`, background: 'var(--success-color, #22A06B)' }} title={\`Passed: \${cPassed}\`}></div>}
                               {cFailed > 0 && <div className="bar-segment" style={{ width: \`\${(cFailed/cTotal)*100}%\`, background: 'var(--danger-color, #E34935)' }} title={\`Failed: \${cFailed}\`}></div>}
                               {cBlocked > 0 && <div className="bar-segment" style={{ width: \`\${(cBlocked/cTotal)*100}%\`, background: 'var(--warning-color, #F6C000)' }} title={\`Blocked: \${cBlocked}\`}></div>}
                               {cNotRun > 0 && <div className="bar-segment" style={{ width: \`\${(cNotRun/cTotal)*100}%\`, background: 'var(--brand-color, #0C66E4)' }} title={\`Not Run: \${cNotRun}\`}></div>}
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
          
          {showBugTimes && (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
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
  };`

let appJs = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

function findBounds(code, startString) {
    const startIdx = code.indexOf(startString);
    if (startIdx === -1) return null;
    
    const blockStartIdx = code.indexOf('=>', startIdx);
    
    let openIdx = -1;
    let openChar = '';
    let closeChar = '';
    
    for (let i = blockStartIdx + 2; i < code.length; i++) {
        if (code[i] === ' ' || code[i] === '\n') continue;
        if (code[i] === '{') { openIdx = i; openChar = '{'; closeChar = '}'; break; }
        if (code[i] === '(') { openIdx = i; openChar = '('; closeChar = ')'; break; }
        break;
    }
    
    if (openIdx === -1) return null;
    
    let count = 0;
    let endIdx = -1;
    for (let i = openIdx; i < code.length; i++) {
        if (code[i] === openChar) count++;
        else if (code[i] === closeChar) {
            count--;
            if (count === 0) {
                endIdx = i;
                break;
            }
        }
    }
    
    return { start: startIdx, end: endIdx };
}

const repBounds = findBounds(appJs, "const renderReportsTab =");
if (repBounds) {
    const finalCode = appJs.substring(0, repBounds.start) + newCode + appJs.substring(repBounds.end + 1);
    fs.writeFileSync('static/hello-world/src/App.js', finalCode);
    console.log("Successfully replaced renderReportsTab with beautiful version!");
} else {
    console.log("Not found in App.js");
}
