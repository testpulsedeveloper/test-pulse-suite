const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      setLoading(true);
      
      const fetchExec = () => {
        invoke('getCycleExecution', { cycleId: selectedCycle.id })
          .then(async (execution) => {
            if (!execution || execution.length === 0) {
              setCycleTests([]);
              setLoading(false);
              return;
            }
            const needsBackfill = execution.filter(t => !t.description);
            if (needsBackfill.length > 0) {
              const updated = await invoke('backfillDescriptions', {
                cycleId: selectedCycle.id,
                testIds: needsBackfill.map(t => t.id)
              });
              setCycleTests(updated || execution);
            } else {
              setCycleTests(execution);
            }
            setLoading(false);
          });
      };`;

const replacement = `  useEffect(() => {
    if (activeTab === 'execution' && selectedCycle) {
      // No usar setLoading(true) global para no parpadear el logo en cada auto-refresh
      const fetchExec = () => {
        invoke('getCycleExecution', { cycleId: selectedCycle.id })
          .then(async (execution) => {
            if (!execution || execution.length === 0) {
              setCycleTests([]);
              return;
            }
            const needsBackfill = execution.filter(t => !t.description);
            if (needsBackfill.length > 0) {
              const updated = await invoke('backfillDescriptions', {
                cycleId: selectedCycle.id,
                testIds: needsBackfill.map(t => t.id)
              });
              setCycleTests(updated || execution);
            } else {
              setCycleTests(execution);
            }
          });
      };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched setLoading out of useEffect!");
} else {
    console.error("Could not find target");
}
