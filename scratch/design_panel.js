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
                          <span className={`status-badge status-${h.status.replace(/\s+/g, '-').toLowerCase()}`}>
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
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleCycleSelect = async (cycle) => {
    setCycleTests([]); // clear old tests immediately
    setSelectedCycle(cycle);
    const execution = await invoke('getCycleExecution', { cycleId: cycle.id });
    safeSetCycleTests(execution || []);
  };

  const handleCreateFolder = async (parentId = null) => {
    const name = prompt("Enter new folder name:");
    if (!name || !selectedProjectId) return;
    setLoading(true);
    const updatedFolders = await invoke('createFolder', { projectId: selectedProjectId, name, parentId: typeof parentId === 'string' ? parentId : null });
    setFolders(updatedFolders || []);
    setLoading(false);
  };

  const handleUpdateFolder = async (folderId, oldName) => {
    const newName = prompt("Enter new folder name:", oldName);
    if (!newName || newName === oldName || !selectedProjectId) return;
    setLoading(true);
    const updatedFolders = await invoke('updateFolder', { projectId: selectedProjectId, folderId, newName });
