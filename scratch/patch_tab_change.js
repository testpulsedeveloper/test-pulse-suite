const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// We will inject safeSetCycleTests right after setCycleTests declaration
const targetDecl = "const [cycleTests, setCycleTests] = useState([]);";
const safeSetCycleTests = `
  const [cycleTests, setCycleTests] = useState([]);
  const deletedIdsRef = useRef(new Set()); // Track local deletions to prevent them coming back from stale backend

  const safeSetCycleTests = useCallback((newExecutionData) => {
      setCycleTests(prev => {
          if (!newExecutionData) return prev;
          
          const backendMap = {};
          newExecutionData.forEach(item => backendMap[item.id] = item);
          
          // 1. Keep items we have locally (avoids them disappearing due to backend read-replica delay)
          const newArray = prev.map(pItem => {
              if (backendMap[pItem.id]) {
                  // Merge backend data (like real status) into local item
                  return { ...pItem, ...backendMap[pItem.id], description: pItem.description || backendMap[pItem.id].description };
              }
              return pItem;
          });
          
          // 2. Add any items from backend that we DON'T have locally, UNLESS we just deleted them
          newExecutionData.forEach(item => {
              if (!prev.some(pItem => pItem.id === item.id) && !deletedIdsRef.current.has(item.id)) {
                  newArray.push(item);
              }
          });
          
          return newArray;
      });
  }, []);
`;

if (!content.includes('safeSetCycleTests = useCallback')) {
    // Add useRef import if missing
    if (!content.includes('useRef')) {
        content = content.replace("useState, useEffect", "useState, useEffect, useRef, useCallback");
    } else {
        content = content.replace("useState, useEffect, useCallback", "useState, useEffect, useRef, useCallback");
    }
    content = content.replace(targetDecl, safeSetCycleTests);
}

// Now replace ALL setCycleTests(execution) and setCycleTests(updated) with safeSetCycleTests
// EXCEPT the ones where we CLEAR the array (e.g. setCycleTests([])) or where we manually filter

content = content.replace(/setCycleTests\(execution \|\| \[\]\);/g, 'safeSetCycleTests(execution || []);');
content = content.replace(/setCycleTests\(execution\);/g, 'safeSetCycleTests(execution);');
content = content.replace(/setCycleTests\(updated \|\| execution\);/g, 'safeSetCycleTests(updated || execution);');
content = content.replace(/if \(updated\) setCycleTests\(updated\);/g, 'if (updated) safeSetCycleTests(updated);');

// Fix handleRemoveTestFromCycle to track deletion
const removeTarget = "setCycleTests(cycleTests.filter(t => t.id !== testId));";
const removeReplacement = "deletedIdsRef.current.add(testId);\n      setCycleTests(cycleTests.filter(t => t.id !== testId));";
content = content.replace(removeTarget, removeReplacement);

// Fix version
content = content.replace(/v1\.4\.4/g, 'v1.4.5');

fs.writeFileSync(path, content);
console.log("Patched App.js with safeSetCycleTests");
