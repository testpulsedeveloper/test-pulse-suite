const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const iterChangeTarget = `  const handleIterationChange = async (test, iterId, field, value) => {
    // Update UI optimistically using old state for responsiveness
    const optimisticIters = [...(test.iterations || [])];
    const optIdx = optimisticIters.findIndex(i => i.id === iterId);
    if (optIdx > -1) {
      optimisticIters[optIdx] = { ...optimisticIters[optIdx], [field]: value };
      setCycleTests(cycleTests.map(t => t.id === test.id ? { ...t, iterations: optimisticIters } : t));
    }
    
    // Fetch fresh state to prevent overwriting evidence
    const freshExec = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    const currentTest = freshExec.find(t => t.id === test.id);
    if (!currentTest) return;
    
    const currentIters = [...(currentTest.iterations || [])];
    const idx = currentIters.findIndex(i => i.id === iterId);
    if (idx > -1) {
      currentIters[idx] = { ...currentIters[idx], [field]: value };
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: currentIters });
      setCycleTests(execution || []);
    }
  };`;

const iterChangeReplacement = `  const handleIterationChange = async (test, iterId, field, value) => {
    try {
      // Update UI optimistically using old state for responsiveness
      const optimisticIters = [...(test.iterations || [])];
      const optIdx = optimisticIters.findIndex(i => i.id === iterId);
      if (optIdx > -1) {
        optimisticIters[optIdx] = { ...optimisticIters[optIdx], [field]: value };
        setCycleTests(cycleTests.map(t => t.id === test.id ? { ...t, iterations: optimisticIters } : t));
      }
      
      // Fetch fresh state to prevent overwriting evidence
      const freshExec = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
      const currentTest = freshExec.find(t => t.id === test.id);
      if (!currentTest) return;
      
      const currentIters = [...(currentTest.iterations || [])];
      const idx = currentIters.findIndex(i => i.id === iterId);
      if (idx > -1) {
        currentIters[idx] = { ...currentIters[idx], [field]: value };
        const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: currentIters });
        setCycleTests(execution || []);
      }
    } catch (e) {
      console.error(e);
      alert("Error guardando datos: " + (e.message || e));
    }
  };`;

if (content.includes(iterChangeTarget)) {
    content = content.replace(iterChangeTarget, iterChangeReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched handleIterationChange error handling!");
} else {
    console.error("Could not find iterChangeTarget");
}
