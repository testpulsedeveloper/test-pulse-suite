const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

let target = `          {showBugTimes && (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
               <h3 style={{ marginBottom: '0.5rem' }}>Resolución de Bugs (Tiempos Promedio en Estado)</h3>
               <div style={{ maxWidth: '600px', margin: '0 auto', border: '1px solid var(--ds-border)', borderRadius: '8px', padding: '1rem', backgroundColor: 'var(--ds-background-neutral)' }}>
                 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                 <thead>
                   <tr style={{ backgroundColor: 'var(--ds-background-neutral)', borderBottom: '1px solid var(--ds-border)' }}>
                     <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left' }}>Estado del Defecto</th>
                     <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Total de Horas</th>
                     <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Promedio (Horas por Bug)</th>
                   </tr>
                 </thead>
                 <tbody>
                   {Object.keys(bugTimes).length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No hay datos suficientes.</td></tr>
                   ) : (
                      Object.entries(bugTimes).sort((a,b) => b[1].totalHours - a[1].totalHours).map(([state, data]) => {
                        const avg = data.count > 0 ? (data.totalHours / data.count) : 0;
                        return (
                          <tr key={state} style={{ borderBottom: '1px solid var(--ds-border)' }}>
                            <td style={{ padding: '0.3rem 0.5rem', textTransform: 'capitalize', fontWeight: '500' }}>{state}</td>
                            <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{data.totalHours.toFixed(1)} hrs</td>
                            <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{avg.toFixed(1)} hrs</td>
                          </tr>
                        );
                      })
                   )}
                 </tbody>
               </table>
               </div>
            </div>
          )}`;

let replacement = `          {showBugTimes && (
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

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('static/hello-world/src/App.js', code);
    console.log("Success");
} else {
    console.log("Not found");
}
