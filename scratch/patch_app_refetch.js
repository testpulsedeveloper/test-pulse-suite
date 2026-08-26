const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    const execution = await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
    setCycleTests(execution || []);
  };`;

const replacement1 = `  const handleAddTestToCycle = async (testCase) => {
    if (!selectedCycle) return;
    await invoke('addTestToCycle', { cycleId: selectedCycle.id, testCase });
    const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
    setCycleTests(execution || []);
  };`;

content = content.replace(target1, replacement1);

const target2 = `                      // Enviar en bloques de 20 para evitar el timeout de 25 segundos de Forge
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          lastExecutionData = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                      }
                      
                      setCycleTests(lastExecutionData || []);`;

const replacement2 = `                      // Enviar en bloques de 20 para evitar el timeout de 25 segundos de Forge
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                      }
                      
                      const finalExecution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
                      setCycleTests(finalExecution || []);`;

content = content.replace(target2, replacement2);

fs.writeFileSync(path, content);
console.log("Patched App.js to refetch execution after add");
