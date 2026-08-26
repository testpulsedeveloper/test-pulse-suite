const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const handleUpdateTestStatus = async (testId, status, comment, evidence, evidences, linkedBugs, steps, iterations, takeover = false) => {
    if (!selectedCycle) return;
    const execution = await invoke('updateTestStatus', { 
      cycleId: selectedCycle.id, testId, status, comment, evidence, evidences, linkedBugs, steps, iterations, takeover 
    });
    setCycleTests(execution);
  };`;

const replacement = `  const handleUpdateTestStatus = async (testId, status, comment, evidence, evidences, linkedBugs, steps, iterations, takeover = false) => {
    if (!selectedCycle) return;
    await invoke('updateTestStatus', { 
      cycleId: selectedCycle.id, testId, status, comment, evidence, evidences, linkedBugs, steps, iterations, takeover 
    });
    const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    setCycleTests(execution || []);
  };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched handleUpdateTestStatus to refetch");
} else {
    console.error("Could not find target in App.js handleUpdateTestStatus");
}
