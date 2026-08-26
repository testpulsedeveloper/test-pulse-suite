const fs = require('fs');
const path = 'static/hello-world/src/App.js';
let content = fs.readFileSync(path, 'utf8');

// Replace remaining <aside className="sidebar glass">
content = content.replace(/<aside className="sidebar glass">/g, '<aside className="sidebar glass" style={{ width: sidebarWidth, flexShrink: 0 }}>');

// Replace all instances of </aside>\s+<main className="main-content">
// or </aside>\s+{/\* Main Content Area \*/}\s+<main className="main-content">
// with </aside><div onMouseDown={() => setIsResizing(true)} style={{ width: '5px', cursor: 'col-resize', backgroundColor: isResizing ? 'var(--ds-border-focused)' : 'transparent', zIndex: 10, borderRight: '1px solid var(--border-color)', marginLeft: '-1px' }} />
content = content.replace(/<\/aside>\s*(?:\{\/\*.*?\*\/\}\s*)?<main className="main-content">/g, 
`</aside>
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
      <main className="main-content">`);

fs.writeFileSync(path, content);
console.log("Patched sidebars globally");
