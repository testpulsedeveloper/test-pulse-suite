const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

let target = `          {showBugTimes && (
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
          )}`;

let replacement = `          {showBugTimes && (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
               <h3 style={{ marginBottom: '0.5rem' }}>Resolución de Bugs (Tiempos Promedio en Estado)</h3>
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
          )}`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('static/hello-world/src/App.js', code);
    console.log("Success");
} else {
    console.log("Not found");
}
