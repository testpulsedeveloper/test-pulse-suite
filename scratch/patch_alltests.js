const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const regexState = /const \[expandedFolders, setExpandedFolders\] = useState\(\{\}\);/;
code = code.replace(regexState, `const [expandedFolders, setExpandedFolders] = useState({});
  const [isAllTestsExpanded, setIsAllTestsExpanded] = useState(true);`);

const regexTree = /<li className=\{\`folder-item \$\{activeFolder === null \? 'active' : ''\}\`} onClick=\{\(\) => setActiveFolder\(null\)\}>\n\s*?<svg width="20" height="20" viewBox="0 0 24 24" fill="var\(--warning-color, #FFAB00\)" stroke="none">\n\s*?<path d="M2\.5 5A2\.5 2\.5 0 015 2\.5h5\.5l1\.65 2\.5H20a2\.5 2\.5 0 012\.5 2\.5v12A2\.5 2\.5 0 0120 22H5a2\.5 2\.5 0 01-2\.5-2\.5V5z" \/>\n\s*?<\/svg>\n\s*?All Tests\n\s*?<\/li>\n\s*?\{\(\(\) => \{/g;

const replaceTree = `<li className={\`folder-item \${activeFolder === null ? 'active' : ''}\`} onClick={() => setActiveFolder(null)} style={{display: 'flex', alignItems: 'center', gap: '0.25rem', paddingLeft: '0.5rem'}}>
            <div style={{width: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer'}} onClick={(e) => { e.stopPropagation(); setIsAllTestsExpanded(prev => !prev); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--text-secondary)'}}>
                {isAllTestsExpanded ? <line x1="5" y1="12" x2="19" y2="12"></line> : <><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></>}
              </svg>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--warning-color, #FFAB00)" stroke="none" style={{flexShrink: 0}}>
              <path d="M2.5 5A2.5 2.5 0 015 2.5h5.5l1.65 2.5H20a2.5 2.5 0 012.5 2.5v12A2.5 2.5 0 0120 22H5a2.5 2.5 0 01-2.5-2.5V5z" />
            </svg>
            All Tests
          </li>
          {isAllTestsExpanded && (() => {`;

code = code.replace(regexTree, replaceTree);

const regexTreeEnd = /\n\s*?\}\)\(\)\}/;
code = code.replace(regexTreeEnd, `
          })()}`);

fs.writeFileSync('static/hello-world/src/App.js', code);
