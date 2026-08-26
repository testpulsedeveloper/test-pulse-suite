const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const execution = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: testsToAdd });
                      setCycleTests(execution || []);
                      setSelectedTestsForCycle([]); // clear selection after adding
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);`;

const replacement = `                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const CHUNK_SIZE = 20;
                      let lastExecutionData = null;
                      
                      // Enviar en bloques de 20 para evitar el timeout de 25 segundos de Forge
                      for (let i = 0; i < testsToAdd.length; i += CHUNK_SIZE) {
                          const chunk = testsToAdd.slice(i, i + CHUNK_SIZE);
                          lastExecutionData = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: chunk });
                      }
                      
                      setCycleTests(lastExecutionData || []);
                      setSelectedTestsForCycle([]); // clear selection after adding
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched App.js frontend chunking for bulk add");
} else {
    console.error("Could not find target for frontend chunking");
}
