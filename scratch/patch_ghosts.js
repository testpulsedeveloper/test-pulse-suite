const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `    if (activeTab === 'execution' && selectedCycle) {
      // No usar setLoading(true) global para no parpadear el logo en cada auto-refresh
      invoke('getCycleExecution', { cycleId: selectedCycle.id })
        .then(async (execution) => {
          if (!execution || execution.length === 0) {
            setCycleTests([]);
            return;
          }
          const needsBackfill = execution.filter(t => !t.description);`;

const replacement = `    if (activeTab === 'execution' && selectedCycle) {
      // No usar setLoading(true) global para no parpadear el logo en cada auto-refresh
      invoke('getCycleExecution', { cycleId: selectedCycle.id })
        .then(async (rawExecution) => {
          if (!rawExecution || rawExecution.length === 0) {
            setCycleTests([]);
            return;
          }
          
          // Eliminar fantasmas: si el caso fue borrado físicamente de Jira, ya no existirá en testCases
          const activeIds = testCases.map(t => t.id);
          const execution = rawExecution.filter(ex => activeIds.includes(ex.id));
          
          const needsBackfill = execution.filter(t => !t.description);`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js to filter ghosts in execution!");
} else {
    console.error("Could not find target in App.js");
}

const planningTarget = `                const isAdded = cycleTests.some(ct => ct.id === test.id);
                return (
                  <div key={test.id} className="test-case-row">`;

const planningReplacement = `                const isAdded = cycleTests.some(ct => ct.id === test.id);
                return (
                  <div key={test.id} className="test-case-row">`;

// Wait, the planning tab shows `testCases`. Ghosts don't exist in `testCases` because `getTestCases` queries live Jira issues!
// If they say "se quedaron los fantasmas de los casos en planning", what do they mean?!
// Oh! If they are in `cycleTests`, the planning tab shows a checkmark "✓ Añadido" next to them!
// Wait! If they deleted them from the cycle, but they still have a checkmark?
// If `cycleTests` contains them, `isAdded` is true. By filtering `cycleTests` against `testCases`, the ghosts won't affect anything!
