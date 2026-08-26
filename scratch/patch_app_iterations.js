const fs = require('fs');

const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Fix handleIterationChange
content = content.replace(
  /const handleIterationChange = async \(test, iterId, field, value\) => \{[\s\S]*?if \(updated\) safeSetCycleTests\(updated\);\s*\} catch \(e\) \{/g,
  `const handleIterationChange = async (test, iterId, field, value) => {
    try {
      const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      setCycleTests(prev => prev.map(t => String(t.id) === String(test.id) ? { ...t, iterations: newIterations, status: newStatus } : t));
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
    } catch (e) {`
);

// Fix handleDeleteEvidence (iterId case)
content = content.replace(
  /          const updated = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, iterations: iters \}\);\s*setCycleTests\(updated\);/g,
  `          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });
          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));`
);

// Fix handleDeleteEvidence (general case)
content = content.replace(
  /    const updated = await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);\s*setCycleTests\(updated\);/g,
  `    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });
    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences } : t));`
);

// Fix handleRenameEvidence (iterId case)
content = content.replace(
  /          setCycleTests\(cycleTests\.map\(t => t\.id === testId \? \{ \.\.\.t, iterations: iters \} : t\)\);\s*await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, iterations: iters \}\);/g,
  `          setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, iterations: iters } : t));
          await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, iterations: iters });`
);

// Fix handleRenameEvidence (general case)
content = content.replace(
  /    setCycleTests\(cycleTests\.map\(t => t\.id === testId \? \{ \.\.\.t, evidences: currentEvidences, evidence: null \} : t\)\);\s*await invoke\('updateTestStatus', \{ cycleId: selectedCycle\.id, testId, evidences: currentEvidences \}\);/g,
  `    setCycleTests(prev => prev.map(t => String(t.id) === String(testId) ? { ...t, evidences: currentEvidences, evidence: null } : t));
    await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, evidences: currentEvidences });`
);

// We also need to fix the "Eliminar Iteración" button text which I missed
content = content.replace(
  /<button\s*onClick=\{\(\) => handleDeleteIteration\(test, iter\.id\)\}\s*title="Eliminar Iteración"\s*disabled=\{!runningTests\[test\.id\]\}\s*style=\{\{\s*background: 'none', border: 'none', cursor: 'pointer', \s*color: 'var\(--danger-color\)', fontSize: '0\.85rem', \s*alignSelf: 'flex-end', padding: 0\s*\}\}\s*>\s*✕ Eliminar Iteración\s*<\/button>/g,
  `<button
                                    onClick={() => handleDeleteIteration(test, iter.id)}
                                    title="Eliminar Iteración"
                                    disabled={!runningTests[test.id]}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer', 
                                      color: 'var(--danger-color)', fontSize: '0.9rem', 
                                      alignSelf: 'flex-end', padding: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                  >
                                    ✕
                                  </button>`
);

fs.writeFileSync(path, content);
console.log("Patched App.js again");
