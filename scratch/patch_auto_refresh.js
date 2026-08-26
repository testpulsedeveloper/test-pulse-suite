const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  const [refreshTrigger, setRefreshTrigger] = useState(0);`;
const replacement = `  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        setRefreshTrigger(prev => prev + 1);
      }
    };
    document.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(path, content);
    console.log("Patched window focus auto-refresh!");
} else {
    console.error("Could not find target");
}
