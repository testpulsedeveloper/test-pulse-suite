const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleCycleSelect = async (cycle) => {
    setSelectedCycle(cycle);
    const execution = await invoke('getCycleExecution', { cycleId: cycle.id });
    setCycleTests(execution || []);
  };`;

const replacement = `  const handleCycleSelect = async (cycle) => {
    setCycleTests([]); // clear old tests immediately
    setSelectedCycle(cycle);
    const execution = await invoke('getCycleExecution', { cycleId: cycle.id });
    setCycleTests(execution || []);
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched handleCycleSelect");
} else {
    console.error("Could not find target");
}
