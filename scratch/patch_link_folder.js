const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target1 = `  const handleLinkTestToFolder = async (testId, folderId) => {
    if (!selectedProjectId) return;
    setLoading(true);
    await invoke('linkTestToFolder', { testId, folderId: folderId === '' ? null : folderId });
    const config = await invoke('getConfig', { projectId: selectedProjectId });
    const fetchedTests = await invoke('getTestCases', { projectId: selectedProjectId, config });
    setTestCases(fetchedTests || []);
    setLoading(false);
  };`;

const replacement1 = `  const handleLinkTestToFolder = async (testId, folderId) => {
    if (!selectedProjectId) return;
    // Update local state instantly (Optimistic UI) to avoid logo flashing
    setTestCases(prev => prev.map(t => t.id === testId ? { ...t, folderId: folderId === '' ? null : folderId } : t));
    
    await invoke('linkTestToFolder', { testId, folderId: folderId === '' ? null : folderId });
  };`;

if (content.includes(target1)) {
    content = content.replace(target1, replacement1);
    fs.writeFileSync(path, content);
    console.log("Patched handleLinkTestToFolder");
} else {
    console.error("Could not find handleLinkTestToFolder");
}
