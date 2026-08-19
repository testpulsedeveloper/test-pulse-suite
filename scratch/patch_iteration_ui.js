const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// The block to move is:
// {(iter.evidences && iter.evidences.length > 0) && (
//   <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.5rem', width: '100%'}}> ... </div>
// )}
// We need to cut it from where it is and paste it after the textarea in the flex:1 column.

const searchString = `                                <div style={{display: 'flex', gap: '0.3rem', justifyContent: 'center'}}>
                                  {(iter.evidences && iter.evidences.length > 0) && (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.5rem', width: '100%'}}>
                                      {iter.evidences.map((ev, idx) => {
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
                                            <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {evName}
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                                if (newName && newName !== evName) {
                                                  handleRenameEvidence(test.id, idx, newName, iter.id);
                                                }
                                              }}
                                              title="Renombrar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✏️</button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEvidence(test.id, evId, idx, iter.id);
                                              }}
                                              title="Quitar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✕</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <label className="btn-secondary"`;

const evidencesBlock = `                                  {(iter.evidences && iter.evidences.length > 0) && (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem', width: '100%'}}>
                                      {iter.evidences.map((ev, idx) => {
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
                                            <span style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {evName}
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newName = prompt("Nuevo nombre para la evidencia:", evName);
                                                if (newName && newName !== evName) {
                                                  handleRenameEvidence(test.id, idx, newName, iter.id);
                                                }
                                              }}
                                              title="Renombrar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✏️</button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEvidence(test.id, evId, idx, iter.id);
                                              }}
                                              title="Quitar evidencia"
                                              style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1}}
                                            >✕</button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}`;

const replaceWithThis = `                                <div style={{display: 'flex', gap: '0.3rem', justifyContent: 'center'}}>
                                  <label className="btn-secondary"`;

const searchTextarea = `                                  style={{width: '100%', minHeight: '50px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', resize: 'vertical'}}
                                />
                              </div>`;

const replaceTextareaWith = `                                  style={{width: '100%', minHeight: '50px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--ds-border)', background: 'var(--bg-main)', color: 'var(--text-primary)', resize: 'vertical'}}
                                />
${evidencesBlock}
                              </div>`;

if (appContent.includes(searchString)) {
  appContent = appContent.replace(searchString, replaceWithThis);
  appContent = appContent.replace(searchTextarea, replaceTextareaWith);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log("Patched iteration evidence UI successfully");
} else {
  console.log("Could not find string to replace");
}
