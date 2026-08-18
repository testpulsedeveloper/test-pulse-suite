const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Add featureStats logic
let reportVarsTarget = `    const testerStats = {};
    const bugTimes = {};
    const execStats = {`;

let reportVarsRepl = `    const testerStats = {};
    const featureStats = {};
    const bugTimes = {};
    const execStats = {`;

code = code.replace(reportVarsTarget, reportVarsRepl);

let reportConfigTarget = `const showBugTimes = conf.showBugTimes !== false;`;
let reportConfigRepl = `const showBugTimes = conf.showBugTimes !== false;
    const showFeatureStats = conf.showFeatureStats !== false;`;

code = code.replace(reportConfigTarget, reportConfigRepl);

let loopTarget = `          // Tester
          const tester = (ex.executedBy && typeof ex.executedBy === 'object') ? (ex.executedBy.displayName || ex.executedBy.name || 'Sin asignar') : (ex.executedBy || 'Sin asignar');
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (ex.status === 'Passed') testerStats[tester].passed++;
          else if (ex.status === 'Failed') testerStats[tester].failed++;
          else if (ex.status === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;`;

let loopRepl = `          // Tester
          const tester = (ex.executedBy && typeof ex.executedBy === 'object') ? (ex.executedBy.displayName || ex.executedBy.name || 'Sin asignar') : (ex.executedBy || 'Sin asignar');
          if (!testerStats[tester]) testerStats[tester] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          testerStats[tester].total++;
          if (ex.status === 'Passed') testerStats[tester].passed++;
          else if (ex.status === 'Failed') testerStats[tester].failed++;
          else if (ex.status === 'Blocked') testerStats[tester].blocked++;
          else testerStats[tester].notRun++;

          // Feature
          const tcFeature = testCases.find(t => t.id === ex.id);
          const fId = tcFeature ? tcFeature.folderId : null;
          let folderPath = fId ? (folderPaths.find(f => f.id === fId)?.path || 'Raíz (Sin Carpeta)') : 'Raíz (Sin Carpeta)';
          
          if (!featureStats[folderPath]) featureStats[folderPath] = { passed: 0, failed: 0, blocked: 0, notRun: 0, total: 0 };
          featureStats[folderPath].total++;
          if (ex.status === 'Passed') featureStats[folderPath].passed++;
          else if (ex.status === 'Failed') featureStats[folderPath].failed++;
          else if (ex.status === 'Blocked') featureStats[folderPath].blocked++;
          else featureStats[folderPath].notRun++;`;

code = code.replace(loopTarget, loopRepl);

// 2. Add Feature stats render block right after tester stats
let testerRenderTarget = `</div>
            </div>
          )}

          {showProgreso && (`;

let testerRenderRepl = `</div>
            </div>
          )}
          
          {showFeatureStats && (
            <div className="chart-card">
              <h3>Estado por Funcionalidad</h3>
              <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(featureStats).sort((a, b) => b[1].total - a[1].total).map(([folder, stats]) => {
                  return (
                    <div className="bar-row" key={folder}>
                      <div className="bar-label">
                        <span title={folder} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{folder}</span>
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

          {showProgreso && (`;

code = code.replace(testerRenderTarget, testerRenderRepl);

// 3. Make donut chart legend bigger
let donutLegendTarget = `<div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>`;
let donutLegendRepl = `<div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: '600' }}>`;

code = code.replace(donutLegendTarget, donutLegendRepl);

// 4. Update config tab to include feature toggle
let configToggleTarget = `<label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showBugTimes !== false}
                     onChange={e => setProjectConfig({...projectConfig, showBugTimes: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Tiempo de Resolución de Defectos (Horas Laborales)</span>
                </label>`;

let configToggleRepl = `<label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showBugTimes !== false}
                     onChange={e => setProjectConfig({...projectConfig, showBugTimes: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Tiempo de Resolución de Defectos (Horas Laborales)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={projectConfig.showFeatureStats !== false}
                     onChange={e => setProjectConfig({...projectConfig, showFeatureStats: e.target.checked})}
                     style={{ width: '1.2rem', height: '1.2rem' }}
                   />
                   <span style={{ fontWeight: '500' }}>Mostrar Casos por Funcionalidad (Carpetas)</span>
                </label>`;

code = code.replace(configToggleTarget, configToggleRepl);


// 5. Make the bug times table compact (wrap in div and restrict max-width, center it, etc)
let bugTimesTarget = `<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>`;
let bugTimesRepl = `<div style={{ maxWidth: '600px', margin: '0 auto', border: '1px solid var(--ds-border)', borderRadius: '8px', padding: '1rem', backgroundColor: 'var(--ds-background-neutral)' }}>
                 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>`;

let bugTimesCloseTarget = `</table>
            </div>`;
let bugTimesCloseRepl = `</table>
               </div>
            </div>`;

code = code.replace(bugTimesTarget, bugTimesRepl).replace(bugTimesCloseTarget, bugTimesCloseRepl);

fs.writeFileSync('static/hello-world/src/App.js', code);
console.log("Replaced successfully!");
