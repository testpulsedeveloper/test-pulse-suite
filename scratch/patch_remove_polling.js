const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Remove the window.focus useEffect
const focusTarget = `  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        setRefreshTrigger(prev => prev + 1);
      }
    };
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);`;

const focusReplacement = `  const [refreshTrigger, setRefreshTrigger] = useState(0);`;

if (content.includes(focusTarget)) {
    content = content.replace(focusTarget, focusReplacement);
    console.log("Patched window focus out");
} else {
    console.error("Could not find focusTarget");
}

// 2. Remove the setInterval
const intervalTarget = `      const fetchExec = () => {
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
      };
      
      fetchExec();
      const interval = setInterval(fetchExec, 10000); // 10-second polling
      
      return () => clearInterval(interval);
    } else if (activeTab === 'reports') {`;

const intervalReplacement = `      invoke('getCycleExecution', { cycleId: selectedCycle.id })
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
    } else if (activeTab === 'reports') {`;

if (content.includes(intervalTarget)) {
    content = content.replace(intervalTarget, intervalReplacement);
    console.log("Patched setInterval out");
} else {
    console.error("Could not find intervalTarget");
}

fs.writeFileSync(path, content);
console.log("Done patching out aggressive polling!");
