const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Move the bug badge next to test.summary, use ladybug emoji, remove it from the end
const bugBadgeRegex = /\{\(test\.linkedBugs && test\.linkedBugs\.length > 0\) && \([\s\S]*?<span style=\{\{[\s\S]*?🐛 \{test\.linkedBugs\.length\}[\s\S]*?<\/span>[\s\S]*?\)\}/;
code = code.replace(bugBadgeRegex, ''); // Remove from old location

const summaryRegex = /<span className="test-summary">\{test\.summary \|\| \(testCases\.find\(t => t\.id === test\.id\)\?\.summary\) \|\| "Caso de prueba"\}<\/span>/;
code = code.replace(summaryRegex, `<span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                      {(test.linkedBugs && test.linkedBugs.length > 0) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem',
                          background: 'var(--danger-bg)', color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)', fontSize: '0.75rem', fontWeight: '600'
                        }} title="Defectos asociados">
                          🐞 {test.linkedBugs.length}
                        </span>
                      )}`);

// Replace the worm emoji with ladybug globally in the code (for the Reportar Bug button and any other places)
code = code.replace(/🐛/g, '🐞');

// 2. Make bugs visible in expanded block regardless of test status
code = code.replace(/\{\(test\.status === 'Failed' \|\| test\.status === 'Blocked'\) && \(/, '{true && (');

// 3. Fix the edit button on general evidence (it wasn't injected correctly by patch_fixes4)
// The problem is the general block evidence map. Let's find it.
const evidenceRegex = /<button[\s\S]*?onClick=\{\(e\) => \{[\s\S]*?e\.stopPropagation\(\);[\s\S]*?handleDeleteEvidence\(test\.id, evId, idx, undefined\);[\s\S]*?\}\}[\s\S]*?title="Quitar evidencia"[\s\S]*?>✕<\/button>/;

code = code.replace(evidenceRegex, (match) => {
  return `<button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                      if (newName && newName !== evName) {
                                        handleRenameEvidence(test.id, idx, newName, undefined);
                                      }
                                    }}
                                    title="Renombrar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0 4px', lineHeight: 1}}
                                  >✏️</button>
                                  ${match}`;
});

// 4. "lo de cerrados =X debe tener un interlineado del número grande para que no se vean encimados"
// 5. "Sigue sin verse la tabla de defectos en las metricas"
// We need to add the bug table inside the reports tab. Let's just append it after the charts in renderReportsTab.

const reportsTabInsert = /<div className="chart-card" style=\{\{ gridColumn: '1 \/ -1' \}\}>[\s\S]*?<h3>Progreso por Ciclo de Pruebas<\/h3>[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?\);/;

let tableRows = `
          {filteredCycles.some(c => c.execution && c.execution.some(ex => ex.linkedBugs && ex.linkedBugs.length > 0)) ? (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem', overflowX: 'auto' }}>
              <h3>Detalle de Defectos Reportados</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem', fontSize: '0.85rem' }}>
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
              </table>
            </div>
          ) : null}
`;

code = code.replace(/(<div className="chart-card" style=\{\{ gridColumn: '1 \/ -1' \}\}>[\s\S]*?<h3>Progreso por Ciclo de Pruebas<\/h3>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/, `$1\n${tableRows}`);


// Fix "cerrados = X" margin
code = code.replace(/<div style=\{\{ fontSize: '1rem', color: 'var\(--success-color, #22A06B\)', fontWeight: 'bold' \}\}>/, 
  `<div style={{ fontSize: '1rem', color: 'var(--success-color, #22A06B)', fontWeight: 'bold', marginTop: '0.5rem' }}>`);

// Add the OS-specific copy instruction to the alert
code = code.replace(/alert\('Plantilla copiada al portapapeles\. Abriendo Gmail\.\.\.'\);/, 
  `const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);`);

fs.writeFileSync('static/hello-world/src/App.js', code);
