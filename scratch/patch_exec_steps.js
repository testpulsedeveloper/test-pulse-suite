const fs = require('fs');
let appJs = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const stepsUI = `
                      {/* --- TEST STEPS --- */}
                      {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'traditional' && executionTestDetails[test.id].content.length > 0 && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                          <h4 style={{margin: 0}}>Pasos del Caso de Prueba</h4>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th style={{width: '50px'}}>Paso</th>
                                <th>Acción</th>
                                <th>Resultado Esperado</th>
                                <th>Datos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {executionTestDetails[test.id].content.map((step, idx) => (
                                <tr key={idx}>
                                  <td style={{textAlign: 'center'}}>{idx + 1}</td>
                                  <td dangerouslySetInnerHTML={{ __html: step.action }} />
                                  <td dangerouslySetInnerHTML={{ __html: step.expectedResult }} />
                                  <td>{step.data || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {/* --- BDD SCENARIOS --- */}
                      {executionTestDetails[test.id] && executionTestDetails[test.id].type === 'bdd' && executionTestDetails[test.id].content.length > 0 && (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingBottom: '1rem', borderBottom: '1px solid var(--ds-border)', marginBottom: '1rem'}}>
                          <h4 style={{margin: 0}}>Escenarios BDD</h4>
                          {executionTestDetails[test.id].content.map((scenario, idx) => (
                            <div key={idx} style={{background: 'var(--bg-surface)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--ds-border)'}}>
                              <h5 style={{margin: '0 0 0.5rem 0'}}>{scenario.title}</h5>
                              <div style={{whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem'}}>{scenario.gherkin}</div>
                            </div>
                          ))}
                        </div>
                      )}
`;

appJs = appJs.replace('{/* --- ITERACIONES --- */}', stepsUI + '\n                      {/* --- ITERACIONES --- */}');

fs.writeFileSync('static/hello-world/src/App.js', appJs);
console.log("Patched test steps UI in execution tab");
