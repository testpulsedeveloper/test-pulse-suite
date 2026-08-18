const renderConfigTab = () => (
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
          <div className="glass" style={{ padding: '2rem', borderRadius: '8px', marginTop: '2rem' }}>
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
                    alert(`Test Pulse ha sido ${enabled ? 'habilitado' : 'deshabilitado'} para este proyecto.`);
                  }}
                />
                Habilitar Test Pulse en este proyecto
              </label>
            </div>
          </div>
        )}

      </main>
    </div>
  )