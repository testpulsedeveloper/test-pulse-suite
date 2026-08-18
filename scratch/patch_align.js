const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// Fix summary fallback
code = code.replace(/<span className="test-summary">\{test\.summary\}<\/span>/, 
  '<span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>');

// Fix Run button alignment
code = code.replace(/width: '32px', height: '32px',/,
  "width: '32px', height: '32px', boxSizing: 'border-box', padding: 0,");

// Fix Status Dropdown alignment
code = code.replace(/width: '100px',\n\s*?textAlign: 'center',/,
  "width: '100px',\n                          height: '32px',\n                          boxSizing: 'border-box',\n                          textAlign: 'center',");

// Fix Bug Badge alignment
code = code.replace(/height: '32px', boxSizing: 'border-box'/,
  "height: '32px', boxSizing: 'border-box', marginTop: 0");

// Add Tester Name in expanded block
const regexExpanded = /\{expandedExecutionTest === test\.id && \([\s\S]*?<div style=\{\{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var\(--ds-border\)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%'\}\}>/;

const replaceExpanded = `{expandedExecutionTest === test.id && (
                    <div style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%'}}>
                      {test.executedBy && (
                        <div style={{fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                           👤 Ejecutado por: <strong>{test.executedBy.displayName}</strong>
                        </div>
                      )}`;

code = code.replace(regexExpanded, replaceExpanded);

fs.writeFileSync('static/hello-world/src/App.js', code);
