const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const badButton = `<button
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
                                  `;

code = code.replace(badButton, '');

fs.writeFileSync('static/hello-world/src/App.js', code);
