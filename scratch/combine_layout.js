const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

let target = `          {showProgreso && (
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
            <div className="chart-card">
               <h3>Resolución de Bugs (Tiempos Promedio en Estado)</h3>
               <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                 {Object.keys(bugTimes).length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No hay datos suficientes.</div>
                 ) : (
                    (() => {
                      const maxAvg = Math.max(...Object.values(bugTimes).map(d => d.count > 0 ? (d.totalHours / d.count) : 0));
                      return Object.entries(bugTimes)
                        .sort((a, b) => {
                           const avgA = a[1].count > 0 ? (a[1].totalHours / a[1].count) : 0;
                           const avgB = b[1].count > 0 ? (b[1].totalHours / b[1].count) : 0;
                           return avgB - avgA;
                        })
                        .map(([state, data]) => {
                          const avg = data.count > 0 ? (data.totalHours / data.count) : 0;
                          const w = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
                          return (
                            <div className="bar-row" key={state}>
                              <div className="bar-label">
                                <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>{state}</span>
                                <div style={{ display: 'flex', gap: '1.5rem', color: 'var(--text-secondary)' }}>
                                  <span>Total: {data.totalHours.toFixed(1)}h</span>
                                  <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>Prom: {avg.toFixed(1)}h</span>
                                </div>
                              </div>
                              <div className="bar-track">
                                {avg > 0 ? (
                                  <div className="bar-segment" style={{ width: \`\${w}%\`, background: 'var(--brand-color, #0C66E4)' }} title={\`Promedio: \${avg.toFixed(1)} hrs\`}></div>
                                ) : (
                                  <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin tiempo medible</div>
                                )}
                              </div>
                            </div>
                          );
                        });
                    })()
                 )}
               </div>
            </div>
          )}`;

let replacement = `          {(showProgreso || showBugTimes) && (
            <div style={{ 
              gridColumn: '1 / -1', 
              display: 'grid', 
              gridTemplateColumns: (showProgreso && showBugTimes) ? '2fr 1fr' : '1fr', 
              gap: '1.5rem', 
              alignItems: 'stretch' 
            }}>
              {showProgreso && (
                <div className="chart-card" style={{ height: '100%', margin: 0 }}>
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
                <div className="chart-card" style={{ height: '100%', margin: 0 }}>
                   <h3>Resolución de Bugs (Tiempo Promedio)</h3>
                   <div className="bar-chart-container" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                     {Object.keys(bugTimes).length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No hay datos suficientes.</div>
                     ) : (
                        (() => {
                          const maxAvg = Math.max(...Object.values(bugTimes).map(d => d.count > 0 ? (d.totalHours / d.count) : 0));
                          return Object.entries(bugTimes)
                            .sort((a, b) => {
                               const avgA = a[1].count > 0 ? (a[1].totalHours / a[1].count) : 0;
                               const avgB = b[1].count > 0 ? (b[1].totalHours / b[1].count) : 0;
                               return avgB - avgA;
                            })
                            .map(([state, data]) => {
                              const avg = data.count > 0 ? (data.totalHours / data.count) : 0;
                              const w = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
                              return (
                                <div className="bar-row" key={state}>
                                  <div className="bar-label">
                                    <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>{state}</span>
                                    <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)' }}>
                                      <span>{data.totalHours.toFixed(1)}h Tot</span>
                                      <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{avg.toFixed(1)}h Prom</span>
                                    </div>
                                  </div>
                                  <div className="bar-track">
                                    {avg > 0 ? (
                                      <div className="bar-segment" style={{ width: \`\${w}%\`, background: 'var(--brand-color, #0C66E4)' }} title={\`Promedio: \${avg.toFixed(1)} hrs\`}></div>
                                    ) : (
                                      <div style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Sin tiempo medible</div>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                        })()
                     )}
                   </div>
                </div>
              )}
            </div>
          )}`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('static/hello-world/src/App.js', code);
    console.log("Success");
} else {
    console.log("Not found");
}
