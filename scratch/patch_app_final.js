const fs = require('fs');
let appJs = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const targetStr = `<h1>Execution: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos)</span></h1>`;

const replacement = `<div style={{display: 'flex', alignItems: 'center'}}>
  <h1>Execution: {selectedCycle.summary} <span style={{fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 'normal'}}>({cycleTests.length} casos)</span></h1>
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

if (appJs.includes(targetStr)) {
    appJs = appJs.replace(targetStr, replacement);
    console.log("Successfully replaced Sync button");
} else {
    console.error("Could not find header!");
}

// And also replace 1.4.9 with 1.2.0 in the footer!
const footerTarget = `<strong>Test Pulse</strong> v1.4.9 © El Puerto de Liverpool`;
const footerReplacement = `<strong>Test Pulse</strong> v1.2.0 © El Puerto de Liverpool`;
if (appJs.includes(footerTarget)) {
    appJs = appJs.replace(footerTarget, footerReplacement);
    console.log("Successfully replaced footer version");
} else {
    console.error("Could not find footer!");
}

fs.writeFileSync('static/hello-world/src/App.js', appJs);
