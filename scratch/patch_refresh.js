const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add refreshTrigger state
const stateHookTarget = `const [searchQuery, setSearchQuery] = useState('');`;
const stateHookReplacement = `const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);`;

if (content.includes(stateHookTarget)) {
    content = content.replace(stateHookTarget, stateHookReplacement);
} else {
    console.error("Could not find stateHookTarget");
}

// 2. Trigger it in loadData
const loadDataTarget = `          if (typeField) setExecutionTypeFieldId(typeField.id);
        }
      }`;
const loadDataReplacement = `          if (typeField) setExecutionTypeFieldId(typeField.id);
        }
        
        // Trigger re-fetch for execution/reports tabs
        setRefreshTrigger(prev => prev + 1);
      }`;

if (content.includes(loadDataTarget)) {
    content = content.replace(loadDataTarget, loadDataReplacement);
} else {
    console.error("Could not find loadDataTarget");
}

// 3. Add to useEffect
const effectTarget = `    }
  }, [activeTab, selectedCycle]);`;
const effectReplacement = `    }
  }, [activeTab, selectedCycle, refreshTrigger]);`;

if (content.includes(effectTarget)) {
    content = content.replace(effectTarget, effectReplacement);
} else {
    console.error("Could not find effectTarget");
}

fs.writeFileSync(path, content);
console.log("Patched App.js with refreshTrigger");
