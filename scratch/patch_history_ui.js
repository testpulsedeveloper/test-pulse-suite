const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

// 1. Add State
appContent = appContent.replace(
  /const \[testCaseDetailsLoading, setTestCaseDetailsLoading\] = useState\(false\);/,
  "const [testCaseDetailsLoading, setTestCaseDetailsLoading] = useState(false);\n  const [testCaseHistory, setTestCaseHistory] = useState([]);"
);

// 2. Update loadTestCaseDetails
const newLoad = `  const loadTestCaseDetails = async (caseId) => {
    setTestCaseDetailsLoading(true);
    setTestCaseHistory([]);
    const [details, history] = await Promise.all([
      invoke('getTestCaseDetails', { caseId }),
      invoke('getTestCaseHistory', { testId: caseId, projectId: selectedProjectId, config: projectConfig })
    ]);
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseHistory(history || []);
    setTestCaseDetailsLoading(false);
  };`;
appContent = appContent.replace(/const loadTestCaseDetails = async \(caseId\) => \{[\s\S]*?setTestCaseDetailsLoading\(false\);\s*\};/, newLoad);

// 3. Clear state on close
appContent = appContent.replace(/setTestCaseDetails\(\{ type: 'traditional', content: \[\] \}\);/g, "setTestCaseDetails({ type: 'traditional', content: [] }); setTestCaseHistory([]);");

// 4. Render History in the slide panel
const oldDescriptionHtml = `            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', marginBottom: '1rem' }}>
              <h3>Description (Issue)</h3>
            </div>
            {selectedTestCase.description ? (
              <div 
                className="description-content"
                dangerouslySetInnerHTML={{ __html: selectedTestCase.description }} 
              />
            ) : (
              <div className="empty-state" style={{padding: '2rem'}}>
                <p>No issue description available.</p>
              </div>
            )}`;

const newDescriptionHtml = `            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', marginBottom: '1rem' }}>
              <h3>Description (Issue)</h3>
            </div>
            {selectedTestCase.description ? (
              <div 
                className="description-content"
                dangerouslySetInnerHTML={{ __html: selectedTestCase.description }} 
              />
            ) : (
              <div className="empty-state" style={{padding: '2rem'}}>
                <p>No issue description available.</p>
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '1rem' }}>
              <h3>Execution History</h3>
            </div>
            {testCaseDetailsLoading ? (
              <div className="empty-state" style={{padding: '1rem'}}>
                <p>Loading history...</p>
              </div>
            ) : testCaseHistory.length > 0 ? (
              <div className="table-container" style={{marginBottom: '2rem'}}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Status</th>
                      <th>Executed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testCaseHistory.map(h => (
                      <tr key={h.cycleId}>
                        <td>
                          <strong>{h.cycleKey}</strong>
                          <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>{h.cycleSummary}</div>
                        </td>
                        <td>
                          <span className={\`status-badge status-\${h.status.replace(/\\s+/g, '-').toLowerCase()}\`}>
                            {h.status}
                          </span>
                        </td>
                        <td>
                          {h.executedBy ? (
                            <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                              <div style={{width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--accent-color)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold'}}>
                                {h.executedBy.displayName.charAt(0)}
                              </div>
                              <span style={{fontSize: '0.85rem'}}>{h.executedBy.displayName}</span>
                            </div>
                          ) : (
                            <span style={{color: 'var(--text-secondary)', fontSize: '0.85rem'}}>Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" style={{padding: '1rem'}}>
                <p>This test case has not been executed in any cycle yet.</p>
              </div>
            )}`;

if (appContent.includes("Description (Issue)")) {
  appContent = appContent.replace(oldDescriptionHtml, newDescriptionHtml);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log("Patched App.js with History UI");
} else {
  console.error("Could not find Description (Issue) to replace.");
}
