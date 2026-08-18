const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const regex = /{expandedExecutionTest === test\.id && \([\s\S]*?<\/div>\n\s*?\)\}\n\s*?<\/li>/;

const replacement = `{expandedExecutionTest === test.id && (
                    <div style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%'}}>

                      {/* Bug actions section - only for Failed or Blocked */}
                      {(test.status === 'Failed' || test.status === 'Blocked') && (
                        <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem'}}>
                          {test.status === 'Failed' && (
                            <button className="btn-secondary" style={{borderColor: 'var(--ds-icon-danger)', color: 'var(--ds-icon-danger)', fontSize: '0.85rem'}} onClick={() => handleCreateBug(test)}>
                              🐛 Reportar Bug
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
                              <span onClick={() => router.open(\`/browse/\${bug.key}\`)} style={{cursor: 'pointer'}}>🐛 {bug.key}</span>
                              <button
                                onClick={async () => {
                                  const updatedBugs = test.linkedBugs.filter((_, i) => i !== idx);
                                  const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, linkedBugs: updatedBugs });
                                  if (updated) setCycleTests(updated);
                                }}
                                title="Quitar vínculo"
                                style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                              >✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{display: 'flex', alignItems: 'flex-start', gap: '1rem'}}>
                        <div style={{flex: 1}}>
                        {test.description && (
                          <div 
                            style={{
                              marginBottom: '1rem', 
                              padding: '1rem', 
                              backgroundColor: 'var(--bg-surface)', 
                              border: '1px solid var(--ds-border)', 
                              borderRadius: '4px',
                              fontSize: '0.9rem'
                            }}
                            dangerouslySetInnerHTML={{ __html: test.description }}
                          />
                        )}
                        {((test.evidences && test.evidences.length > 0) || test.evidence) && (
                          <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem'}}>
                            {(test.evidences || (test.evidence ? [test.evidence] : [])).map((ev, idx) => {
                              const evId = typeof ev === 'string' ? ev : ev.id;
                              const evName = typeof ev === 'string' ? \`evidence_\${evId}.jpg\` : (ev.filename || \`evidence_\${evId}.jpg\`);
                              return (
                              <div 
                                key={idx}
                                onClick={() => handlePreviewEvidence(ev)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                  padding: '0.25rem 0.5rem', background: 'var(--ds-background-neutral)', 
                                  borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                                  border: '1px solid var(--ds-border)', color: 'var(--text-secondary)'
                                }}
                                title={evName}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {evName}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteEvidence(test.id, evId, idx);
                                  }}
                                  title="Quitar evidencia"
                                  style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                >✕</button>
                              </div>
                            )})}
                          </div>
                        )}
                      </div>
                      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                        <label className="btn-secondary" style={{padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center'}} title="Adjuntar Evidencia">
                          <input 
                            type="file" 
                            style={{display: 'none'}} 
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                handleUploadEvidence(test.id, test.key, e.target.files[0]);
                              }
                            }}
                          />
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </label>
                        <button 
                          className="btn-secondary" 
                          style={{padding: '0.4rem', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center'}} 
                          title="Grabar pantalla"
                          onClick={() => handleCaptureScreen(test.id, test.key)}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                        </button>
                       </div>
                      </div>

                      {/* --- ITERACIONES --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Iteraciones (Data-Driven)</h4>
                          <button onClick={() => handleAddIteration(test)} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem'}}>+ Agregar iteración</button>
                        </div>
                        
                        {(!test.iterations || test.iterations.length === 0) ? (
                          <div style={{color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic'}}>No hay iteraciones. Haz clic en "+ Agregar iteración" para comenzar.</div>
                        ) : (
                          test.iterations.map((iter, idx) => (
                            <div key={iter.id} style={{display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'var(--bg-surface)', padding: '0.8rem', borderRadius: '6px', border: '1px solid var(--ds-border)'}}>
                              <div style={{fontWeight: 'bold', width: '24px', color: 'var(--text-secondary)'}}>#{idx + 1}</div>
                              <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                                <input 
                                  type="text" 
                                  placeholder="Datos de prueba (Ej: Usuario=admin, Pass=123)" 
                                  defaultValue={iter.expectedData || ''}
                                  onBlur={e => { if (e.target.value !== iter.expectedData) handleIterationChange(test, iter.id, 'expectedData', e.target.value); }}
                                  style={{width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)'}}
                                />
                                <textarea 
                                  placeholder="Resultado actual..." 
                                  defaultValue={iter.actualResult || ''}
                                  onBlur={e => { if (e.target.value !== iter.actualResult) handleIterationChange(test, iter.id, 'actualResult', e.target.value); }}
                                  style={{width: '100%', minHeight: '50px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', resize: 'vertical'}}
                                />
                              </div>
                              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '120px'}}>
                                <select 
                                  value={iter.status || 'Not Run'}
                                  onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                  className="status-badge"
                                  style={{width: '100%', padding: '0.4rem', border: 'none', cursor: 'pointer', background: getStatusColor(iter.status || 'Not Run'), color: getStatusTextColor(iter.status || 'Not Run')}}
                                >
                                  <option value="Not Run" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Sin Ejecutar</option>
                                  <option value="Passed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Exitoso</option>
                                  <option value="Failed" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Fallido</option>
                                  <option value="Blocked" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Bloqueado</option>
                                </select>
                                <div style={{display: 'flex', gap: '0.3rem', justifyContent: 'center'}}>
                                  <label className="btn-secondary" style={{padding: '0.3rem', cursor: 'pointer'}} title="Adjuntar evidencia">
                                    <input 
                                      type="file" 
                                      style={{display: 'none'}} 
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files.length > 0) {
                                          handleUploadEvidence(test.id, test.key, e.target.files[0], iter.id);
                                        }
                                      }}
                                    />
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                  </label>
                                  <button title="Grabar pantalla" className="btn-secondary" style={{padding: '0.3rem'}} onClick={() => handleCaptureScreen(test.id, test.key, iter.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg></button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </li>`;

code = code.replace(regex, replacement);
fs.writeFileSync('static/hello-world/src/App.js', code);
