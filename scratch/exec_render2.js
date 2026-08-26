                        </div>
                      )}
                      
                      {/* --- DETALLES GENERALES DEL CASO --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                        <div style={{width: '100%'}}>
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
                                const evName = typeof ev === 'string' ? `evidence_${evId}.jpg` : (ev.filename || `evidence_${evId}.jpg`);
                                return (
                                <div 
                                  key={idx}
                                  onClick={() => handlePreviewEvidence(ev)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.25rem', 
                                    padding: '0.25rem 0.5rem', background: 'var(--bg-surface-hover)', 
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
                                      const newName = prompt("Nuevo nombre para la evidencia:", evName);
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
                                      handleDeleteEvidence(test.id, evId, idx, undefined);
                                    }}
                                    title="Quitar evidencia"
                                    disabled={!runningTests[test.id]}
                                    style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                  >✕</button>
                                </div>
                              )})}
                            </div>
                          )}
                        </div>
                        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem'}}>
                          <span style={{fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)'}}>Evidencias Generales:</span>
                          <label className="btn-secondary" style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} title="Adjuntar Evidencia (Archivo)" style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                            <input disabled={!runningTests[test.id]} 
                              type="file" 
                              style={{display: 'none'}} 
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                  handleUploadEvidence(test.id, test.key, e.target.files[0]);
                                }
                              }}
                            />
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> Archivo
                          </label>
                          <button 
                            className="btn-secondary" 
                            style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} 
                            title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                            disabled={!runningTests[test.id]}
                            style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Grabar
                          </button>
                        </div>
                      </div>

                      {/* --- ITERACIONES --- */}
                      <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                          <h4 style={{margin: 0}}>Iteraciones (Data-Driven)</h4>
                          <button onClick={() => handleAddIteration(test)} disabled={!runningTests[test.id]} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem', opacity: !runningTests[test.id] ? 0.5 : 1}}>+ Agregar iteración</button>
                        </div>
                        
