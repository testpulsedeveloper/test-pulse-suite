const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add handleDeleteIteration handler
const targetHandler = `  const handleAddIteration = async (test) => {
    try {
      const newIter = { id: Date.now().toString(), expectedData: '', actualResult: '', status: 'Not Run' };
      const newIterations = test.iterations ? [...test.iterations, newIter] : [newIter];
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };`;

const replacementHandler = `  const handleAddIteration = async (test) => {
    try {
      const newIter = { id: Date.now().toString(), expectedData: '', actualResult: '', status: 'Not Run' };
      const newIterations = test.iterations ? [...test.iterations, newIter] : [newIter];
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteIteration = async (test, iterId) => {
    if (!window.confirm("¿Estás seguro de eliminar esta iteración?")) return;
    try {
      const newIterations = (test.iterations || []).filter(it => it.id !== iterId);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
      alert("Error eliminando iteración: " + (e.message || e));
    }
  };`;

if (content.includes(targetHandler)) {
    content = content.replace(targetHandler, replacementHandler);
    console.log("Patched handleDeleteIteration");
} else {
    console.error("Could not find targetHandler");
}

// 2. Add the delete button to UI
const uiTarget = `                              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '160px', alignItems: 'flex-end'}}>
                                <select 
                                  value={iter.status || 'Not Run'}`;

const uiReplacement = `                              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '160px', alignItems: 'flex-end'}}>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleDeleteIteration(test, iter.id)}
                                    title="Eliminar Iteración"
                                    disabled={!runningTests[test.id]}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer', 
                                      color: 'var(--danger-color)', fontSize: '0.85rem', 
                                      alignSelf: 'flex-end', padding: 0
                                    }}
                                  >
                                    ✕ Eliminar Iteración
                                  </button>
                                )}
                                <select 
                                  value={iter.status || 'Not Run'}`;

if (content.includes(uiTarget)) {
    content = content.replace(uiTarget, uiReplacement);
    console.log("Patched delete iteration UI");
} else {
    console.error("Could not find uiTarget");
}

fs.writeFileSync(path, content);
console.log("Done patching delete iteration!");
