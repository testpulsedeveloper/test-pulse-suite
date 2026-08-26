const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add states for Sidebar Resizing
const stateHookTarget = "const [isAllTestsExpanded, setIsAllTestsExpanded] = useState(true);";
const stateHookReplacement = `const [isAllTestsExpanded, setIsAllTestsExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e) => {
      let newWidth = e.clientX;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);`;

if (content.includes(stateHookTarget)) {
    content = content.replace(stateHookTarget, stateHookReplacement);
} else {
    console.error("Failed to find stateHookTarget");
}

// 2. Change renderDesignTab to use the state
const sidebarTarget = `<aside className="sidebar glass">`;
const sidebarReplacement = `<aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>`;

if (content.includes(sidebarTarget)) {
    content = content.replace(sidebarTarget, sidebarReplacement);
} else {
    console.error("Failed to find sidebarTarget");
}

// 3. Add Resizer div after </aside> in renderDesignTab
const asideEndTarget = `</aside>
      {/* Main Content */}`;
const asideEndReplacement = `</aside>
      <div 
        onMouseDown={() => setIsResizing(true)}
        style={{
          width: '5px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent',
          zIndex: 10,
          borderRight: '1px solid var(--border-color)',
          marginLeft: '-1px'
        }}
      />
      {/* Main Content */}`;

if (content.includes(asideEndTarget)) {
    content = content.replace(asideEndTarget, asideEndReplacement);
} else {
    console.error("Failed to find asideEndTarget");
}

// 4. Update Report states
const reportStateTarget = `const [reportSelectedPlan, setReportSelectedPlan] = useState('');
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycle, setReportSelectedCycle] = useState('');`;
const reportStateReplacement = `const [reportSelectedPlans, setReportSelectedPlans] = useState([]);
  const [bugResolutionTime, setBugResolutionTime] = useState(null);
  const [reportSelectedCycles, setReportSelectedCycles] = useState([]);`;

if (content.includes(reportStateTarget)) {
    content = content.replace(reportStateTarget, reportStateReplacement);
} else {
    console.error("Failed to find reportStateTarget");
}

// 5. Update Report Filter logic
const reportFilterTarget = `    let filteredCycles = reportData.cycles || [];
    if (reportSelectedPlan) {
      filteredCycles = filteredCycles.filter(c => c.planId === reportSelectedPlan);
    }
    if (reportSelectedCycle) {
      filteredCycles = filteredCycles.filter(c => c.id === reportSelectedCycle);
    }`;
const reportFilterReplacement = `    let filteredCycles = reportData.cycles || [];
    if (reportSelectedPlans && reportSelectedPlans.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedPlans.includes(c.planId));
    }
    if (reportSelectedCycles && reportSelectedCycles.length > 0) {
      filteredCycles = filteredCycles.filter(c => reportSelectedCycles.includes(c.id));
    }`;

if (content.includes(reportFilterTarget)) {
    content = content.replace(reportFilterTarget, reportFilterReplacement);
} else {
    console.error("Failed to find reportFilterTarget");
}

// 6. Replace Selects with Checkbox dropdowns
const reportSelectsTarget = `<select 
              value={reportSelectedPlan} 
              onChange={e => { setReportSelectedPlan(e.target.value); setReportSelectedCycle(''); }}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">1. PROYECTO (Todos los Planes)</option>
              {testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}
            </select>
            <select 
              value={reportSelectedCycle} 
              onChange={e => setReportSelectedCycle(e.target.value)}
              style={{padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)'}}
            >
              <option value="">2. VERSIÓN (Todos los Ciclos)</option>
              {(reportSelectedPlan ? (reportData.cycles || []).filter(c => c.planId === reportSelectedPlan) : (reportData.cycles || [])).map(c => 
                <option key={c.id} value={c.id}>{c.summary}</option>
              )}
            </select>`;
const reportSelectsReplacement = `<details style={{ position: 'relative' }}>
              <summary style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', minWidth: '180px' }}>
                {reportSelectedPlans.length === 0 ? "Todos los Planes" : \`\${reportSelectedPlans.length} Planes seleccionados\`}
              </summary>
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', zIndex: 10, padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                 <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" checked={reportSelectedPlans.length === 0} onChange={() => { setReportSelectedPlans([]); setReportSelectedCycles([]); }} /> Todos los Planes
                 </label>
                 {testPlans.map(p => (
                   <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                     <input type="checkbox" checked={reportSelectedPlans.includes(p.id)} onChange={(e) => {
                       let newVals = [...reportSelectedPlans];
                       if (e.target.checked) newVals.push(p.id);
                       else newVals = newVals.filter(v => v !== p.id);
                       setReportSelectedPlans(newVals);
                       setReportSelectedCycles([]);
                     }} />
                     {p.summary}
                   </label>
                 ))}
              </div>
            </details>

            <details style={{ position: 'relative' }}>
              <summary style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', cursor: 'pointer', minWidth: '180px' }}>
                {reportSelectedCycles.length === 0 ? "Todos los Ciclos" : \`\${reportSelectedCycles.length} Ciclos seleccionados\`}
              </summary>
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', zIndex: 10, padding: '0.5rem', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '220px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                 <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                   <input type="checkbox" checked={reportSelectedCycles.length === 0} onChange={() => { setReportSelectedCycles([]); }} /> Todos los Ciclos
                 </label>
                 {(reportSelectedPlans.length > 0 ? (reportData.cycles || []).filter(c => reportSelectedPlans.includes(c.planId)) : (reportData.cycles || [])).map(c => (
                   <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                     <input type="checkbox" checked={reportSelectedCycles.includes(c.id)} onChange={(e) => {
                       let newVals = [...reportSelectedCycles];
                       if (e.target.checked) newVals.push(c.id);
                       else newVals = newVals.filter(v => v !== c.id);
                       setReportSelectedCycles(newVals);
                     }} />
                     {c.summary}
                   </label>
                 ))}
              </div>
            </details>`;

if (content.includes(reportSelectsTarget)) {
    content = content.replace(reportSelectsTarget, reportSelectsReplacement);
} else {
    console.error("Failed to find reportSelectsTarget");
}

fs.writeFileSync(path, content);
console.log("Patched App.js successfully!");
