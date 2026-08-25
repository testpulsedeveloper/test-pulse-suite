const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. General evidence "Archivo" label
content = content.replace(
  `title="Adjuntar Evidencia (Archivo)">
                            <input `,
  `title="Adjuntar Evidencia (Archivo)" style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                            <input disabled={!runningTests[test.id]} `
);

// 2. General evidence "Grabar pantalla" button
content = content.replace(
  `title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}`,
  `title="Grabar pantalla"
                            onClick={() => handleCaptureScreen(test.id, test.key)}
                            disabled={!runningTests[test.id]}
                            style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}`
);

// 3. "+ Agregar iteración" button
content = content.replace(
  `onClick={() => handleAddIteration(test)} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem'}}>+ Agregar iteración</button>`,
  `onClick={() => handleAddIteration(test)} disabled={!runningTests[test.id]} className="btn-secondary" style={{fontSize: '0.8rem', padding: '0.3rem 0.6rem', opacity: !runningTests[test.id] ? 0.5 : 1}}>+ Agregar iteración</button>`
);

// 4. Iteration expectedData input
content = content.replace(
  `placeholder="Datos de prueba (Ej: Usuario=admin, Pass=123)" 
                                  defaultValue={iter.expectedData || ''}`,
  `placeholder="Datos de prueba (Ej: Usuario=admin, Pass=123)" 
                                  defaultValue={iter.expectedData || ''}
                                  disabled={!runningTests[test.id]}`
);

// 5. Iteration actualResult textarea
content = content.replace(
  `placeholder="Resultado actual..." 
                                  defaultValue={iter.actualResult || ''}`,
  `placeholder="Resultado actual..." 
                                  defaultValue={iter.actualResult || ''}
                                  disabled={!runningTests[test.id]}`
);

// 6. Iteration status select
content = content.replace(
  `<select 
                                  value={iter.status || 'Not Run'}
                                  onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                  className="status-badge"`,
  `<select 
                                  value={iter.status || 'Not Run'}
                                  onChange={e => handleIterationChange(test, iter.id, 'status', e.target.value)}
                                  className="status-badge"
                                  disabled={!runningTests[test.id]}`
);

// 7. Iteration evidence "Adjuntar evidencia" label
content = content.replace(
  `title="Adjuntar evidencia">
                                    <input 
                                      type="file"`,
  `title="Adjuntar evidencia" style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                                    <input 
                                      disabled={!runningTests[test.id]}
                                      type="file"`
);

// 8. Iteration evidence "Grabar pantalla" button
content = content.replace(
  `onClick={() => handleCaptureScreen(test.id, test.key, iter.id)}>
                                    <svg width="16"`,
  `onClick={() => handleCaptureScreen(test.id, test.key, iter.id)} disabled={!runningTests[test.id]} style={!runningTests[test.id] ? {opacity: 0.5, pointerEvents: 'none'} : {}}>
                                    <svg width="16"`
);

// 9. Iteration evidence Rename and Remove buttons - actually I'll just leave them but disabled
content = content.replace(
  `title="Renombrar evidencia"
                                              style={{background: 'none'`,
  `title="Renombrar evidencia"
                                              disabled={!runningTests[test.id]}
                                              style={{background: 'none'`
);

content = content.replace(
  `title="Quitar evidencia"
                                              style={{background: 'none'`,
  `title="Quitar evidencia"
                                              disabled={!runningTests[test.id]}
                                              style={{background: 'none'`
);

// Wait, the general evidence Rename and Remove buttons
content = content.replace(
  `title="Renombrar evidencia"
                                    style={{background: 'none'`,
  `title="Renombrar evidencia"
                                    disabled={!runningTests[test.id]}
                                    style={{background: 'none'`
);

content = content.replace(
  `title="Quitar evidencia"
                                    style={{background: 'none'`,
  `title="Quitar evidencia"
                                    disabled={!runningTests[test.id]}
                                    style={{background: 'none'`
);


fs.writeFileSync('static/hello-world/src/App.js', content);
console.log('Patched App.js to disable fields if not running');
