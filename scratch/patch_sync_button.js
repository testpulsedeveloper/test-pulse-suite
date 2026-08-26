const fs = require('fs');
let appJs = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// The cycle title is rendered in renderExecutionTab:
// <h2 style={{margin: 0, color: 'var(--primary-color)'}}>Execution: {selectedCycle?.summary} <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>({cycleTests.length} casos)</span></h2>

const targetStr = `<h2 style={{margin: 0, color: 'var(--primary-color)'}}>Execution: {selectedCycle?.summary} <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>({cycleTests.length} casos)</span></h2>`;

const replacement = `<div style={{display: 'flex', alignItems: 'center'}}>
  <h2 style={{margin: 0, color: 'var(--primary-color)'}}>Execution: {selectedCycle?.summary} <span style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>({cycleTests.length} casos)</span></h2>
  {selectedCycle && (
    <button 
      className="btn-secondary" 
      onClick={async () => {
        setLoading(true);
        const updated = await invoke('backfillDescriptions', {
          cycleId: selectedCycle.id,
          testIds: cycleTests.map(t => t.id),
          force: true
        });
        if (updated) safeSetCycleTests(updated);
        setLoading(false);
      }}
      style={{marginLeft: '1rem', fontSize: '0.8rem', padding: '0.3rem 0.6rem'}}
      title="Sincronizar información desde Jira"
    >
      🔄 Sincronizar Info
    </button>
  )}
</div>`;

appJs = appJs.replace(targetStr, replacement);
fs.writeFileSync('static/hello-world/src/App.js', appJs);
console.log("Added Sync button to execution view");
