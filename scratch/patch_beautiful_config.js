const fs = require('fs');

const newConfig = `const renderConfigTab = () => (
    <div className="tab-layout">
      <main className="main-content" style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div className="header">
          <h1>Project Configurations</h1>
        </div>
        
        {!selectedProjectId ? (
          <div className="empty-state">
            <p>Please select a project from the top navigation to configure issue types.</p>
          </div>
        ) : (
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Map Issue Types</h2>
            <p style={{ marginBottom: '2rem', color: 'var(--ds-text-subtlest)' }}>
              Select the custom Jira issue types used in this project to represent Test Cases, Test Cycles, and Test Sets.
            </p>
            
            <form onSubmit={handleSaveConfig}>
              <div className="form-group">
                <label>Test Case Issue Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.testCaseType}
                  onChange={(e) => setProjectConfig({...projectConfig, testCaseType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Test Cycle Issue Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.testCycleType}
                  onChange={(e) => setProjectConfig({...projectConfig, testCycleType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Test Plan Issue Type (Test Set)</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.planIssueType || ''}
                  onChange={(e) => setProjectConfig({...projectConfig, planIssueType: e.target.value})}
                  required
                >
                  <option value="">Select an issue type...</option>
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
              </div>

              <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
              <h3 style={{ marginBottom: '1rem' }}>Requirements Traceability</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Select the issue types that represent requirements (e.g., Story, Epic) and the link type used to connect Test Cases to those requirements.
              </p>

              <div className="form-group">
                <label>Requirement Issue Types</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)', height: '100px' }}
                  multiple
                  value={projectConfig.requirementIssueTypes || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
                    setProjectConfig({...projectConfig, requirementIssueTypes: selected});
                  }}
                >
                  {projectIssueTypes.map(it => (
                    <option key={it.id} value={it.name}>{it.name}</option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-secondary)' }}>Hold Ctrl/Cmd to select multiple.</small>
              </div>

              <div className="form-group">
                <label>Test-to-Requirement Link Type</label>
                <select 
                  className="status-badge"
                  style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--ds-border)' }}
                  value={projectConfig.requirementLinkType || 'ANY'}
                  onChange={(e) => setProjectConfig({...projectConfig, requirementLinkType: e.target.value})}
                >
                  <option value="ANY">Any Link Type</option>
                  {linkTypes.map(lt => (
                    <option key={lt.id} value={lt.name}>{lt.name} ({lt.outward} / {lt.inward})</option>
                  ))}
                </select>
              </div>
              
              <hr style={{ margin: '2rem 0', borderColor: 'var(--ds-border)' }} />
              <h3 style={{ marginBottom: '1rem' }}>Widgets del Tablero de Reportes</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Selecciona qué métricas y gráficas estarán visibles en la pestaña de Reportes.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
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

              <div style={{ marginTop: '2rem' }}>
                <button type="submit" className="btn-primary" disabled={isSavingConfig}>
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Allowlist Section (Admin only) */}
        {selectedProjectId && isAdmin && (
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px', marginTop: '2rem', marginBottom: '2rem' }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--danger-color)' }}>Restricción por Proyecto</h2>
            <p style={{ marginBottom: '1rem', color: 'var(--ds-text-subtlest)' }}>
              Puedes habilitar o deshabilitar Test Pulse específicamente para este proyecto.
              Si lo deshabilitas, los usuarios regulares no podrán ver ni usar la app aquí.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 'bold' }}>
                <input 
                  type="checkbox" 
                  checked={isProjectAllowed}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setIsProjectAllowed(enabled);
                    await invoke('setAllowedProjects', { projectId: selectedProjectId, enabled });
                    alert(\`Test Pulse ha sido \${enabled ? 'habilitado' : 'deshabilitado'} para este proyecto.\`);
                  }}
                />
                Habilitar Test Pulse en este proyecto
              </label>
            </div>
          </div>
        )}

      </main>
    </div>
  );`

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

const confBounds = findBounds(appJs, "const renderConfigTab =");
if (confBounds) {
    const finalCode = appJs.substring(0, confBounds.start) + newConfig + appJs.substring(confBounds.end + 1);
    fs.writeFileSync('static/hello-world/src/App.js', finalCode);
    console.log("Successfully replaced renderConfigTab with original beautiful version!");
} else {
    console.log("Not found in App.js");
}
