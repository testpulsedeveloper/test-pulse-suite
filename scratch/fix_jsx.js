const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldHtml = `                        </div>
                        
                        </div>
                        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem'}}>`;

const newHtml = `                        </div>
                        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem'}}>`;

appContent = appContent.replace(oldHtml, newHtml);

// And we also had duplicate keys in the iteration background: background: 'var(--bg-surface)' and background: 'var(--bg-surface-hover)'.
appContent = appContent.replace(
  /background: 'var\(--bg-surface\)', padding: '1rem', borderRadius: '8px', border: '1px solid var\(--ds-border\)', background: 'var\(--bg-surface-hover\)'/g,
  "background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--ds-border)'"
);

fs.writeFileSync('static/hello-world/src/App.js', appContent);
console.log("Fixed JSX errors");
