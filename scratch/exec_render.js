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
                          </button>
                          {/* Inline input */}
                          {linkingBugTestId === test.id && (
                            <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                              <input
                                autoFocus
                                type="text"
                                value={bugKeyInput}
                                onChange={e => setBugKeyInput(e.target.value.toUpperCase())}
                                onKeyDown={async e => {
                                  if (e.key === 'Enter' && bugKeyInput.trim()) {
                                    await doLinkBug(test, bugKeyInput.trim());
                                    setLinkingBugTestId(null); setBugKeyInput('');
                                  } else if (e.key === 'Escape') { setLinkingBugTestId(null); }
                                }}
                                placeholder="Key del bug (ej: CU-10)"
                                style={{
                                  padding: '0.3rem 0.5rem', fontSize: '0.85rem', width: '150px',
                                  border: '1px solid var(--danger-color)', borderRadius: '4px',
                                  background: 'var(--bg-surface)', color: 'var(--text-primary)'
                                }}
                              />
                              <button onClick={async () => { if (bugKeyInput.trim()) { await doLinkBug(test, bugKeyInput.trim()); setLinkingBugTestId(null); setBugKeyInput(''); } }}
                                style={{padding: '0.3rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer', background: 'var(--danger-color)', color: '#fff', border: 'none', borderRadius: '4px'}}
                              >Vincular</button>
                              <button onClick={() => { setLinkingBugTestId(null); setBugKeyInput(''); }}
                                style={{padding: '0.3rem 0.5rem', fontSize: '0.8rem', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)'}}
                              >✕</button>
                            </div>
                          )}
                          {/* Bug badges with unlink button */}
                          {(test.linkedBugs && test.linkedBugs.length > 0) && test.linkedBugs.map((bug, idx) => (
                            <span key={idx} style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '0.2rem 0.4rem 0.2rem 0.6rem', borderRadius: '4px',
                              background: 'var(--danger-bg)', color: 'var(--danger-color)',
                              border: '1px solid var(--danger-color)', fontSize: '0.8rem', fontWeight: '600'
                            }}>
                              <span onClick={() => router.open(`/browse/${bug.key}`)} style={{cursor: 'pointer'}}>🐞 {bug.key}</span>
                              <button
                                onClick={async () => {
                                  const updatedBugs = test.linkedBugs.filter((_, i) => i !== idx);
                                  const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, linkedBugs: updatedBugs });
                                  if (updated) safeSetCycleTests(updated);
                                }}
                                title="Quitar vínculo"
                                style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                              >✕</button>
                            </span>
                          ))}
