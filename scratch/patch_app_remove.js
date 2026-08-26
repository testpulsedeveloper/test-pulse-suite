const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleRemoveTestFromCycle = async (testId) => {
    if (!selectedCycle) return;
    const execution = await invoke('removeTestFromCycle', { cycleId: selectedCycle.id, testId });
    setCycleTests(execution || []);
  };`;

const replacement = `  const handleRemoveTestFromCycle = async (testId) => {
    if (!selectedCycle) return;
    await invoke('removeTestFromCycle', { cycleId: selectedCycle.id, testId });
    const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    setCycleTests(execution || []);
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js remove handler");
} else {
    console.error("Could not find target in App.js for remove");
}
