const fs = require('fs');

const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. handleUpdateTestStatus
content = content.replace(
  /const handleUpdateTestStatus = async \(testId, status, comment\) => \{[\s\S]*?safeSetCycleTests\(execution \|\| \[\]\);\s*\} catch \(e\) \{/g,
  `const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    try {
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { 
        ...t, 
        status: status !== undefined ? status : t.status, 
        comment: comment !== undefined ? comment : t.comment 
      } : t));
    } catch (e) {`
);

// 2. handleAddIteration
content = content.replace(
  /const handleAddIteration = async \(test\) => \{[\s\S]*?if \(updated\) safeSetCycleTests\(updated\);\s*\} catch \(e\) \{/g,
  `const handleAddIteration = async (test) => {
    try {
      const newIter = { id: Date.now().toString(), expectedData: '', actualResult: '', status: 'Not Run' };
      const newIterations = test.iterations ? [...test.iterations, newIter] : [newIter];
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
    } catch (e) {`
);

// 3. handleDeleteIteration
content = content.replace(
  /const handleDeleteIteration = async \(test, iterId\) => \{[\s\S]*?if \(updated\) safeSetCycleTests\(updated\);\s*\} catch \(e\) \{/g,
  `const handleDeleteIteration = async (test, iterId) => {
    if (!window.confirm("¿Estás seguro de eliminar esta iteración?")) return;
    try {
      const newIterations = (test.iterations || []).filter(it => it.id !== iterId);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
    } catch (e) {`
);

// 4. handleIterationChange
content = content.replace(
  /const handleIterationChange = async \(testId, iterId, field, value\) => \{[\s\S]*?if \(updated\) safeSetCycleTests\(updated\);\s*\} catch \(e\) \{/g,
  `const handleIterationChange = async (testId, iterId, field, value) => {
    const test = cycleTests.find(t => t.id === testId);
    if (!test || !test.iterations) return;
    const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
    const newStatus = calculateIterationStatus(newIterations) || test.status;
    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: newIterations, status: newStatus } : t));
    try {
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: newIterations, status: newStatus });
    } catch (e) {`
);

// 5. handleAddEvidence (Both iterIdx !== null and null)
content = content.replace(
  /const execution = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, iterations: iters \}\);\s*safeSetCycleTests\(execution \|\| \[\]\);/g,
  `await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
               setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));`
);

content = content.replace(
  /const execution = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidence: newName \}\);\s*safeSetCycleTests\(execution \|\| \[\]\);/g,
  `await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidence: newName });
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidence: newName } : t));`
);

content = content.replace(
  /const execution = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);\s*safeSetCycleTests\(execution \|\| \[\]\);/g,
  `await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
            setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));`
);

// 6. Delete Iteration UI button
content = content.replace(
  /<button onClick=\{\(\) => handleDeleteIteration\(test, iter\.id\)\} className="btn-secondary" style=\{\{color: 'var\(--danger-color\)', padding: '0\.2rem 0\.5rem', fontSize: '0\.7rem'\}\}>Eliminar iteración<\/button>/g,
  `<button onClick={() => handleDeleteIteration(test, iter.id)} className="btn-secondary" style={{color: 'var(--danger-color)', padding: '0.2rem 0.4rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px'}} title="Eliminar iteración">✕</button>`
);

// 7. Iteration status dropdown UI
content = content.replace(
  /<div style=\{\{display: 'flex', alignItems: 'center', gap: '0\.5rem'\}\}>\s*<span style=\{\{fontSize: '0\.8rem', fontWeight: 600, color: 'var\(--text-secondary\)'\}\}>Status:<\/span>\s*<select \s*value=\{iter\.status \|\| 'Not Run'\} \s*onChange=\{\(e\) => handleIterationChange\(test\.id, iter\.id, 'status', e\.target\.value\)\}\s*disabled=\{!runningTests\[test\.id\]\}\s*style=\{\{\s*padding: '0\.3rem',\s*borderRadius: '4px',\s*border: '1px solid var\(--ds-border\)',\s*background: 'var\(--bg-surface\)',\s*color: 'var\(--text-primary\)',\s*cursor: !runningTests\[test\.id\] \? 'not-allowed' : 'pointer'\s*\}\}\s*>\s*<option value="Not Run">Not Run<\/option>\s*<option value="Passed">Passed<\/option>\s*<option value="Failed">Failed<\/option>\s*<option value="Blocked">Blocked<\/option>\s*<\/select>\s*<\/div>/g,
  `<div style={{display: 'flex', alignItems: 'center'}}>
                            <select 
                              value={iter.status || 'Not Run'} 
                              onChange={(e) => handleIterationChange(test.id, iter.id, 'status', e.target.value)}
                              disabled={!runningTests[test.id]}
                              style={{
                                backgroundColor: getStatusColor(iter.status || 'Not Run'),
                                color: getStatusTextColor(iter.status || 'Not Run'),
                                border: 'none',
                                cursor: !runningTests[test.id] ? 'not-allowed' : 'pointer',
                                opacity: !runningTests[test.id] ? 0.6 : 1,
                                padding: '0.3rem 0.5rem',
                                width: '90px',
                                height: '28px',
                                boxSizing: 'border-box',
                                textAlign: 'center',
                                textAlignLast: 'center',
                                borderRadius: '4px',
                                fontSize: '0.8rem'
                              }}
                            >
                              <option value="Not Run" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Not Run</option>
                              <option value="Passed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Passed</option>
                              <option value="Failed" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Failed</option>
                              <option value="Blocked" style={{backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)'}}>Blocked</option>
                            </select>
                          </div>`
);


fs.writeFileSync(path, content);
console.log("Patched App.js");
