const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `              <span className="status-badge">{selectedTestCase.status}</span>
            </div>
            <button className="close-btn" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}>&times;</button>`;

const replacement = `              <div style={{display: 'flex', gap: '0.5rem', marginTop: '0.5rem'}}>
                <span className="status-badge">{selectedTestCase.status}</span>
                {selectedTestCase.rawFields?.priority && (
                  <span className="status-badge" style={{ background: 'var(--bg-surface)', border: '1px solid var(--ds-border)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {selectedTestCase.rawFields.priority.iconUrl && <img src={selectedTestCase.rawFields.priority.iconUrl} alt="" width="16" height="16" />}
                    {selectedTestCase.rawFields.priority.name}
                  </span>
                )}
              </div>
            </div>
            <button className="close-btn" onClick={() => { setSelectedTestCase(null); setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]); }}>&times;</button>`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched test case priority");
} else {
    // try alternative target
    console.error("Could not find target");
}
