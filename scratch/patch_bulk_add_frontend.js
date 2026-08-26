const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state for isAddingAll
const stateTarget = `  const [runningTests, setRunningTests] = useState({});`;
const stateReplacement = `  const [runningTests, setRunningTests] = useState({});
  const [isAddingAll, setIsAddingAll] = useState(false);`;

if (content.includes(stateTarget)) {
    content = content.replace(stateTarget, stateReplacement);
}

// 2. Patch the Add All button
const btnTarget = `                  onClick={async () => {
                    const testsToAdd = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id));
                    if (testsToAdd.length === 0) return;
                    setLoading(true);
                    for (const test of testsToAdd) {
                      await handleAddTestToCycle(test);
                    }
                    setLoading(false);
                  }}
                  disabled={loading}
                >
                  + Añadir todos
                </button>`;

const btnReplacement = `                  onClick={async () => {
                    const testsToAdd = testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id));
                    if (testsToAdd.length === 0) return;
                    setIsAddingAll(true);
                    try {
                      const execution = await invoke('addBulkTestsToCycle', { cycleId: selectedCycle.id, testCases: testsToAdd });
                      setCycleTests(execution || []);
                    } catch(err) {
                      console.error(err);
                      alert("Error al añadir casos: " + err.message);
                    }
                    setIsAddingAll(false);
                  }}
                  disabled={loading || isAddingAll}
                >
                  {isAddingAll ? 'Añadiendo casos...' : '+ Añadir todos'}
                </button>`;

if (content.includes(btnTarget)) {
    content = content.replace(btnTarget, btnReplacement);
    fs.writeFileSync(path, content);
    console.log("Patched Add All frontend!");
} else {
    console.error("Could not find btnTarget");
}
