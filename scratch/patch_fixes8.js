const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Move bug badge next to test.summary in execution tab (only where handleToggleExecutionTest is used)
const oldSummaryLine = `<span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>`;
const newSummaryLine = `<span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                      {(test.linkedBugs && test.linkedBugs.length > 0) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem',
                          background: 'var(--danger-bg)', color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)', fontSize: '0.75rem', fontWeight: '600'
                        }} title="Defectos asociados">
                          🐞 {test.linkedBugs.length}
                        </span>
                      )}`;

// Split by Execution tab vs Plan tab
let parts = code.split('<main className="main-content">');
// parts[1] is inside renderExecutionTab because it's right after `<aside className="sidebar">` in renderExecutionTab. Wait, both tabs have `<main className="main-content">` !
// Let's replace ONLY the second occurrence which is execution tab
if (parts.length > 2) {
  parts[2] = parts[2].replace(oldSummaryLine, newSummaryLine);
  code = parts.join('<main className="main-content">');
}

// Remove the old bug badge from the end of the line
const oldBugBadgeRegex = /\{\(test\.linkedBugs && test\.linkedBugs\.length > 0\) && \([\s\S]*?<span style=\{\{[\s\S]*?🐛 \{test\.linkedBugs\.length\}[\s\S]*?<\/span>[\s\S]*?\)\}/;
code = code.replace(oldBugBadgeRegex, '');

// Replace all 🐛 with 🐞
code = code.replace(/🐛/g, '🐞');

// 2. Make bugs visible in expanded block regardless of test status
code = code.replace(/\{\(test\.status === 'Failed' \|\| test\.status === 'Blocked'\) && \(/, '{true && (');


// 3. Fix the edit button on general evidence
// Let's replace the EXACT button code in the general evidence map
const exactEvidenceButton = `<button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteEvidence(test.id, evId, idx, undefined);
                                    }}
                                    title="Quitar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                  >✕</button>`;

const newEvidenceButton = `<button
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
                                  ${exactEvidenceButton}`;

code = code.replace(exactEvidenceButton, newEvidenceButton);


// 4. "lo de cerrados =X debe tener un interlineado del número grande para que no se vean encimados"
code = code.replace(/<div style=\{\{ fontSize: '1rem', color: 'var\(--success-color, #22A06B\)', fontWeight: 'bold' \}\}>/, 
  `<div style={{ fontSize: '1rem', color: 'var(--success-color, #22A06B)', fontWeight: 'bold', marginTop: '0.5rem' }}>`);

// Add OS-specific copy instruction
code = code.replace(/alert\('Plantilla copiada al portapapeles\. Abriendo Gmail\.\.\.'\);/, 
  `const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      alert(\`Plantilla copiada al portapapeles. Usa \${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...\`);`);

// 5. Add bugs table to reports tab
const tableRows = `
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

fs.writeFileSync('static/hello-world/src/App.js', code);
