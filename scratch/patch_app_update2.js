const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    try {
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      setCycleTests(execution || []);
    } catch (e) {
      console.error(e);
      alert("Error actualizando prueba: " + (e.message || e));
    }
  };`;

const replacement = `  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    try {
      await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
      setCycleTests(execution || []);
    } catch (e) {
      console.error(e);
      alert("Error actualizando prueba: " + (e.message || e));
    }
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js handleUpdateTestStatus");
} else {
    console.error("Could not find target in App.js for handleUpdateTestStatus");
}
