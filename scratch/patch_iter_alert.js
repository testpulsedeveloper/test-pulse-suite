const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleIterationChange = async (test, iterId, field, value) => {
    try {
      const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
    }
  };`;

const replacement = `  const handleIterationChange = async (test, iterId, field, value) => {
    try {
      const newIterations = test.iterations.map(it => it.id === iterId ? { ...it, [field]: value } : it);
      const newStatus = calculateIterationStatus(newIterations) || test.status;
      const updated = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId: test.id, iterations: newIterations, status: newStatus });
      if (updated) setCycleTests(updated);
    } catch (e) {
      console.error(e);
      alert("Error guardando cambios de texto: " + (e.message || e));
    }
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched iteration error alert!");
} else {
    console.error("Could not find iteration target");
}
