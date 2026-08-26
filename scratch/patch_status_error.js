const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const statusTarget = `  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
    setCycleTests(execution || []);
  };`;

const statusReplacement = `  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    try {
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      setCycleTests(execution || []);
    } catch (e) {
      console.error(e);
      alert("Error actualizando prueba: " + (e.message || e));
    }
  };`;

if (content.includes(statusTarget)) {
    content = content.replace(statusTarget, statusReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched handleUpdateTestStatus error handling!");
} else {
    // If it doesn't have comment param
    const statusTarget2 = `  const handleUpdateTestStatus = async (testId, status) => {
    if (!selectedCycle) return;
    const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status });
    setCycleTests(execution || []);
  };`;
  const statusReplacement2 = `  const handleUpdateTestStatus = async (testId, status, comment) => {
    if (!selectedCycle) return;
    try {
      const execution = await invoke('updateTestStatus', { cycleId: selectedCycle.id, testId, status, comment });
      setCycleTests(execution || []);
    } catch (e) {
      console.error(e);
      alert("Error actualizando prueba: " + (e.message || e));
    }
  };`;
    if (content.includes(statusTarget2)) {
        content = content.replace(statusTarget2, statusReplacement2);
        fs.writeFileSync(path, content);
        console.log("Patched handleUpdateTestStatus (v2) error handling!");
    } else {
        console.error("Could not find statusTarget");
    }
}
