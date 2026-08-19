const fs = require('fs');

let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Update the General Case details container
const oldGeneralDetails = `<div style={{display: 'flex', alignItems: 'flex-start', gap: '1rem'}}>
                        <div style={{flex: 1}}>`;

const newGeneralDetails = `<div style={{display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                        <div style={{width: '100%'}}>`;

appContent = appContent.replace(oldGeneralDetails, newGeneralDetails);

// Move the evidence buttons into a row instead of a column
const oldButtons = `<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                          <label className="btn-secondary" style={{padding: '0.4rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', borderRadius: '4px'}} title="Adjuntar Evidencia">`;

const newButtons = `</div>
                        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem'}}>
                          <span style={{fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)'}}>Evidencias Generales:</span>
                          <label className="btn-secondary" style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} title="Adjuntar Evidencia (Archivo)">`;

appContent = appContent.replace(oldButtons, newButtons);

const oldCaptureButton = `                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                          </label>
                          <button 
                            className="btn-secondary" 
                            style={{padding: '0.4rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', borderRadius: '4px'}} 
                            title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                          </button>
                        </div>
                      </div>`;

const newCaptureButton = `                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> Archivo
                          </label>
                          <button 
                            className="btn-secondary" 
                            style={{padding: '0.4rem 0.8rem', border: '1px solid var(--ds-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '4px', fontSize: '0.85rem'}} 
                            title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Grabar
                          </button>
                        </div>
                      </div>`;

appContent = appContent.replace(oldCaptureButton, newCaptureButton);

// Update iterations layout
const oldIterationWrap = `<div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '120px'}}>`;
const newIterationWrap = `<div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '160px', alignItems: 'flex-end'}}>`;

appContent = appContent.replace(oldIterationWrap, newIterationWrap);

// Improve iteration padding
appContent = appContent.replace(
  /padding: '0\.8rem', borderRadius: '6px', border: '1px solid var\(--ds-border\)'/g,
  "padding: '1rem', borderRadius: '8px', border: '1px solid var(--ds-border)', background: 'var(--bg-surface-hover)'"
);

fs.writeFileSync('static/hello-world/src/App.js', appContent);
console.log("Patched App.js UI clutter");
