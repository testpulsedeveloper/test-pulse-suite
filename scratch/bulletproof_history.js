const fs = require('fs');
let appContent = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldLoad = `    const [details, history] = await Promise.all([
      invoke('getTestCaseDetails', { caseId }),
      invoke('getTestCaseHistory', { testId: caseId, projectId: selectedProjectId, config: projectConfig })
    ]);
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseHistory(history || []);`;

const newLoad = `    let details = { type: 'traditional', content: [] };
    let history = [];
    try {
      details = await invoke('getTestCaseDetails', { caseId });
    } catch(e) {
      console.error('Error loading details:', e);
    }
    
    try {
      history = await invoke('getTestCaseHistory', { testId: caseId, projectId: selectedProjectId, config: projectConfig });
    } catch(e) {
      console.error('Error loading history:', e);
    }
    
    setTestCaseDetails(details || { type: 'traditional', content: [] });
    setTestCaseHistory(history || []);`;

if(appContent.includes("Promise.all([")) {
  appContent = appContent.replace(oldLoad, newLoad);
  fs.writeFileSync('static/hello-world/src/App.js', appContent);
  console.log("Bulletproofed loadTestCaseDetails");
} else {
  console.log("Could not find Promise.all logic");
}
