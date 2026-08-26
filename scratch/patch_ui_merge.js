const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `            const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
            if (execution) setCycleTests(execution);`;
            
const replace1 = `            const execution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
            if (execution) {
                setCycleTests(prev => {
                    const merged = [...execution];
                    prev.forEach(pItem => {
                        if (!merged.some(mItem => mItem.id === pItem.id)) {
                            merged.push(pItem);
                        }
                    });
                    return merged;
                });
            }`;

content = content.replace(target1, replace1);

const target2 = `                          const finalExecution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
                          if (finalExecution) setCycleTests(finalExecution);`;

const replace2 = `                          const finalExecution = await invoke('getCycleExecution', { cycleId: selectedCycle.id });
                          if (finalExecution) {
                              setCycleTests(prev => {
                                  const merged = [...finalExecution];
                                  prev.forEach(pItem => {
                                      if (!merged.some(mItem => mItem.id === pItem.id)) {
                                          merged.push(pItem);
                                      }
                                  });
                                  return merged;
                              });
                          }`;

content = content.replace(target2, replace2);

content = content.replace(/v1\.4\.3/g, 'v1.4.4');

fs.writeFileSync(path, content);
console.log("Patched App.js with bulletproof merge");
