const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const tableBlock = `          {filteredCycles.some(c => c.execution && c.execution.some(ex => ex.linkedBugs && ex.linkedBugs.length > 0)) ? (
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
          ) : null}`;

// Remove it from its current position
code = code.replace(tableBlock, '');

// Insert it right before the end of the reports tab div
const targetEnd = `             </div>
          </div>
          
        </div>
      </div>
    );
  };`;

const newEnd = `             </div>
          </div>
          
${tableBlock}
        </div>
      </div>
    );
  };`;

code = code.replace(targetEnd, newEnd);
fs.writeFileSync('static/hello-world/src/App.js', code);
