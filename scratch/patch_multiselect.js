const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Add state selectedTestsForCycle
const stateTarget = `  const [planningFolder, setPlanningFolder] = useState('');`;
const stateReplacement = `  const [planningFolder, setPlanningFolder] = useState('');
  const [selectedTestsForCycle, setSelectedTestsForCycle] = useState([]);`;
content = content.replace(stateTarget, stateReplacement);

// Fix cycle change to reset checkboxes
const planChangeTarget = `        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); }}`;
const planChangeReplacement = `        <select 
          value={selectedPlanId} 
          onChange={e => { setSelectedPlanId(e.target.value); setSelectedCycle(null); setSelectedTestsForCycle([]); }}`;
content = content.replace(planChangeTarget, planChangeReplacement);

const cycleChangeTarget = `                    onClick={() => setSelectedCycle(cycle)}
                    style={{cursor: 'pointer', padding: '0.5rem', borderRadius: '4px', background: selectedCycle?.id === cycle.id ? 'var(--ds-background-selected)' : 'transparent'}}`;
const cycleChangeReplacement = `                    onClick={() => { setSelectedCycle(cycle); setSelectedTestsForCycle([]); }}
                    style={{cursor: 'pointer', padding: '0.5rem', borderRadius: '4px', background: selectedCycle?.id === cycle.id ? 'var(--ds-background-selected)' : 'transparent'}}`;
content = content.replace(cycleChangeTarget, cycleChangeReplacement);


// Update the UI
const uiTarget = `              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => setPlanningFolder(e.target.value)}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <button 
                  className="btn-primary" 
                  onClick={async () => {
                    const testsToAdd = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id));
                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const execution = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: testsToAdd });
                      setCycleTests(execution || []);
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);
                  }}
                  disabled={loading || isAddingAll}
                >
                  {isAddingAll ? 'Añadiendo casos...' : '+ Añadir todos'}
                </button>
              </div>
            </div>
            <div className="test-list">
              {testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id)).map(test => (
                <div key={test.id} className="test-card glass" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div className="test-card-content">
                    <span className="test-id">{test.key}</span>
                    <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                  </div>
                  <button className="btn-secondary" onClick={() => handleAddTestToCycle(test)}>+ Add to Cycle</button>
                </div>
              ))}
            </div>`;

const uiReplacement = `              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => {
                      setPlanningFolder(e.target.value);
                      setSelectedTestsForCycle([]); // reset selection on folder change
                  }}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <button 
                  className="btn-primary" 
                  onClick={async () => {
                    const allAvailable = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id));
                    // Si hay tests seleccionados manualmente, usar esos. Si no, añadir todos los disponibles
                    const testsToAdd = selectedTestsForCycle.length > 0 
                      ? testCases.filter(tc => selectedTestsForCycle.includes(tc.id))
                      : allAvailable;
                      
                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const execution = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: testsToAdd });
                      setCycleTests(execution || []);
                      setSelectedTestsForCycle([]); // clear selection after adding
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);
                  }}
                  disabled={loading || isAddingAll}
                >
                  {isAddingAll ? 'Añadiendo casos...' : (selectedTestsForCycle.length > 0 ? \`+ Añadir (\${selectedTestsForCycle.length})\` : '+ Añadir todos')}
                </button>
              </div>
            </div>
            <div className="test-list">
              {testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id)).map(test => (
                <div 
                   key={test.id} 
                   className="test-card glass" 
                   style={{
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      cursor: 'pointer',
                      border: selectedTestsForCycle.includes(test.id) ? '1px solid var(--accent-color)' : ''
                   }}
                   onClick={() => {
                      setSelectedTestsForCycle(prev => 
                         prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id]
                      );
                   }}
                >
                  <div className="test-card-content" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedTestsForCycle.includes(test.id)} 
                      readOnly
                      style={{ transform: 'scale(1.2)' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                       <span className="test-id">{test.key}</span>
                       <span className="test-summary">{test.summary || (testCases.find(t => t.id === test.id)?.summary) || "Caso de prueba"}</span>
                    </div>
                  </div>
                  <button 
                     className="btn-secondary" 
                     onClick={(e) => {
                        e.stopPropagation();
                        handleAddTestToCycle(test);
                     }}
                  >
                     + Add
                  </button>
                </div>
              ))}
            </div>`;

if (content.includes(uiTarget)) {
    content = content.replace(uiTarget, uiReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js with multi-select capability");
} else {
    console.error("Could not find uiTarget");
}
