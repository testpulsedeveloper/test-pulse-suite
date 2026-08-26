const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Add planningPriority state
const stateTarget = `  const [planningFolder, setPlanningFolder] = useState('');
  const [selectedTestsForCycle, setSelectedTestsForCycle] = useState([]);`;
const stateReplacement = `  const [planningFolder, setPlanningFolder] = useState('');
  const [planningPriority, setPlanningPriority] = useState('');
  const [selectedTestsForCycle, setSelectedTestsForCycle] = useState([]);`;
content = content.replace(stateTarget, stateReplacement);

// Update UI
const uiTarget = `              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => {
                      setPlanningFolder(e.target.value);
                      setSelectedTestsForCycle([]); // reset selection on folder change
                  }}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <button `;

const uiReplacement = `              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  value={planningFolder} 
                  onChange={e => {
                      setPlanningFolder(e.target.value);
                      setSelectedTestsForCycle([]); // reset selection on folder change
                  }}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Carpetas</option>
                  {folderPaths.map(f => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
                <select
                  value={planningPriority}
                  onChange={e => {
                      setPlanningPriority(e.target.value);
                      setSelectedTestsForCycle([]); // reset selection on priority change
                  }}
                  className="status-badge"
                  style={{ padding: '0.4rem', background: 'var(--bg-surface)' }}
                >
                  <option value="">Todas las Prioridades</option>
                  {Array.from(new Set(testCases.map(tc => tc.rawFields?.priority?.name).filter(Boolean))).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <button `;
content = content.replace(uiTarget, uiReplacement);

const filterTarget = `testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && !cycleTests.some(ct => ct.id === tc.id))`;
const filterReplacement = `testCases.filter(tc => (planningFolder === '' || tc.folderId === planningFolder) && (planningPriority === '' || tc.rawFields?.priority?.name === planningPriority) && !cycleTests.some(ct => ct.id === tc.id))`;

// Reemplazar todas las ocurrencias en renderPlanningTab
content = content.split(filterTarget).join(filterReplacement);

fs.writeFileSync(path, content);
console.log("Patched App.js with priority filtering");
