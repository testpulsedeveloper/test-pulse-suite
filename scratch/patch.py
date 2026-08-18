import re

with open('static/hello-world/src/App.js', 'r') as f:
    lines = f.readlines()

new_lines = []
in_execution = False
skip_lines = 0

for i, line in enumerate(lines):
    if skip_lines > 0:
        skip_lines -= 1
        continue

    if '<h1>Execution: {selectedCycle.summary}</h1>' in line:
        in_execution = True
    elif '<h1>Reports</h1>' in line:
        in_execution = False
        
    if in_execution:
        # Move bug badge next to test.summary
        if '<span className="test-summary">{test.summary ||' in line:
            new_lines.append(line)
            new_lines.append("""                      {(test.linkedBugs && test.linkedBugs.length > 0) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem',
                          background: 'var(--danger-bg)', color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)', fontSize: '0.75rem', fontWeight: '600'
                        }} title="Defectos asociados">
                          🐞 {test.linkedBugs.length}
                        </span>
                      )}
""")
            continue
            
        # Delete old bug badge
        if '{/* Bug count badge - collapsed view */}' in line:
            skip_lines = 11
            continue
        
        # Make bugs visible in expanded block regardless of test status
        if "{(test.status === 'Failed' || test.status === 'Blocked') && (" in line:
            new_lines.append(line.replace("{(test.status === 'Failed' || test.status === 'Blocked') && (", "{true && ("))
            continue
            
        # Fix the edit button on general evidence
        if 'handleDeleteEvidence(test.id, evId, idx, undefined);' in line:
            new_lines.append("""                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                      if (newName && newName !== evName) {
                                        handleRenameEvidence(test.id, idx, newName, undefined);
                                      }
                                    }}
                                    title="Renombrar evidencia"
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0 4px', lineHeight: 1}}
                                  >✏️</button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
""")
            new_lines.append(line)
            continue
            
    # Global replace of worm with ladybug
    line = line.replace('🐛', '🐞')
    
    # Fix "cerrados = X" margin
    line = line.replace("<div style={{ fontSize: '1rem', color: 'var(--success-color, #22A06B)', fontWeight: 'bold' }}>",
                        "<div style={{ fontSize: '1rem', color: 'var(--success-color, #22A06B)', fontWeight: 'bold', marginTop: '0.5rem' }}>")
                        
    # Add OS-specific copy instruction
    line = line.replace("alert('Plantilla copiada al portapapeles. Abriendo Gmail...');",
                        "const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0; alert(`Plantilla copiada al portapapeles. Usa ${isMac ? 'Cmd + V' : 'Ctrl + V'} en el correo para pegar la tabla. Abriendo Gmail...`);")
                        
    # Add bugs table to reports tab
    if "<h3>Progreso por Ciclo de Pruebas</h3>" in line:
        table_html = """          {filteredCycles.some(c => c.execution && c.execution.some(ex => ex.linkedBugs && ex.linkedBugs.length > 0)) ? (
            <div className="chart-card" style={{ gridColumn: '1 / -1', marginTop: '1rem', overflowX: 'auto', marginBottom: '1rem' }}>
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
                          <td style={{ padding: '0.5rem' }}><a href={`/browse/${bug.key}`} target="_blank" rel="noreferrer">{bug.key}</a></td>
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
"""
        new_lines.insert(len(new_lines)-2, table_html)

    new_lines.append(line)

with open('static/hello-world/src/App.js', 'w') as f:
    f.writelines(new_lines)
