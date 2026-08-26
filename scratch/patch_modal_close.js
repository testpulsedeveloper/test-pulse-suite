const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h2 style={{margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)'}}>{previewModalData.filename}</h2>
              <button className="btn-secondary" onClick={() => setPreviewModalData(null)}>✕ Cerrar</button>
            </div>`;

const replacement = `            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h2 style={{margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1}}>{previewModalData.filename}</h2>
              <button className="btn-secondary" onClick={() => setPreviewModalData(null)} style={{flexShrink: 0, marginLeft: '1rem', padding: '0.4rem 0.8rem', background: 'var(--danger-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 10000}}>✕ Cerrar</button>
            </div>`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched modal close button");
} else {
    console.error("Could not find target");
}
