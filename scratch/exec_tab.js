  const renderExecutionTab = () => (
    <div className="tab-layout">
      {/* Cycles Sidebar */}
      <aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>
        <h2>Test Plans</h2>
        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); }}
          className="status-badge"
          style={{width: '100%', marginBottom: '1rem', padding: '0.5rem'}}
        >
          <option value="">Select a Test Plan...</option>
          {testPlans.map(plan => (
            <option key={plan.id} value={plan.id}>{plan.summary}</option>
          ))}
        </select>
        
        {selectedPlanId && (
          <>
            <h3>Active Cycles</h3>
            <ul className="folder-list">
              {filteredTestCycles.filter(c => c.planId === selectedPlanId).map(cycle => (
                <li key={cycle.id} className={`folder-item ${selectedCycle?.id === cycle.id ? 'active' : ''}`} onClick={() => handleCycleSelect(cycle)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                  {cycle.summary}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--border-color)',
          marginLeft: '-1px'
        }}
      />
      <main className="main-content">
        {selectedCycle ? (
          <div>
            <div className="header">
              <h1>Execution: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos)</span></h1>
            </div>
            
            <div className="test-list">
              {cycleTests.map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', flexDirection: 'column'}}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 100px 1fr auto', gap: '1rem', alignItems: 'center', width: '100%' }}>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform: expandedExecutionTest === test.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s'}}><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </div>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer'}}>
                      <span className="test-id">{test.key}</span>
                    </div>
                    <div onClick={() => handleToggleExecutionTest(test.id)} style={{cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                      <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                      {(test.linkedBugs && test.linkedBugs.length > 0) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.5rem',
                          background: 'var(--danger-bg)', color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)', fontSize: '0.75rem', fontWeight: '600'
                        }} title="Defectos asociados">
                          🐞 {test.linkedBugs.length}
                        </span>
                      )}
                    </div>
                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0}}>
                      <button 
                        title={runningTests[test.id] ? 'Detener Ejecución' : 'Iniciar Ejecución'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (runningTests[test.id]) {
                            setRunningTests(prev => ({ ...prev, [test.id]: null }));
                          } else {
                            handleRunTest(test.id, test.key, test); 
                          }
                        }}
                        disabled={runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading'}
                        style={{
                          padding: '0.4rem', background: runningTests[test.id] ? '#ff991f' : 'var(--accent-color, #0C66E4)',
                          color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '32px', height: '32px', boxSizing: 'border-box', marginTop: 0, padding: 0,
                          opacity: (runningTests[test.id] === 'capturing' || runningTests[test.id] === 'uploading') ? 0.7 : 1
                        }}
                      >
                        {runningTests[test.id] === 'capturing' ? '⏹' : 
                         runningTests[test.id] === 'uploading' ? '⏳' : 
                         runningTests[test.id] ? '⏹' : '▶'}
                      </button>
                      <select 
                        className="status-badge" 
                        value={test.status === 'To Do' ? 'Not Run' : test.status} 
                        onChange={(e) => handleUpdateTestStatus(test.id, e.target.value)}
                        disabled={!runningTests[test.id]}
                        style={{
                          backgroundColor: getStatusColor(test.status),
                          color: getStatusTextColor(test.status),
                          border: 'none',
                          cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                          opacity: !runningTests[test.id] ? 0.6 : 1,
                          padding: '0.4rem 0.5rem',
                          width: '100px',
                          height: '32px',
                          boxSizing: 'border-box',
                          textAlign: 'center',
                          textAlignLast: 'center'
                        }}
                      >
                        <option value="Not Run" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Not Run</option>
                        <option value="Passed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Passed</option>
                        <option value="Failed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Failed</option>
                        <option value="Blocked" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Blocked</option>
                      </select>
                      
                    </div>
                  </div>
                  
                  {expandedExecutionTest === test.id && (
                    <div style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%'}}>
                      {test.executedBy && (
                        <div style={{fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                           👤 Ejecutado por: <strong>{test.executedBy.displayName}</strong>
                        </div>
                      )}

                      {/* Bug actions section - only for Failed or Blocked */}
                      {true && (
                        <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem'}}>
                          {test.status === 'Failed' && (
                            <button className="btn-secondary" style={{borderColor: 'var(--ds-icon-danger)', color: 'var(--ds-icon-danger)', fontSize: '0.85rem'}} onClick={() => handleCreateBug(test)}>
                              🐞 Reportar Bug
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            onClick={() => { setLinkingBugTestId(linkingBugTestId === test.id ? null : test.id); setBugKeyInput(''); }}
                            style={{fontSize: '0.85rem'}}
                          >
                            🔗 Vincular Bug existente
