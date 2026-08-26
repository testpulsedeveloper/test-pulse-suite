const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

content += `
/* Mobile Responsive Styles */
@media (max-width: 768px) {
  .tab-layout {
    flex-direction: column !important;
  }
  .sidebar {
    width: 100% !important;
    max-height: 250px;
    overflow-y: auto;
    border-right: none !important;
    border-bottom: 2px solid var(--border-color);
  }
  .main-content {
    width: 100% !important;
    padding: 1rem !important;
  }
  /* Hide the drag resizer on mobile */
  .tab-layout > div[style*="col-resize"] {
    display: none !important;
  }
  .header {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 1rem;
  }
  .nav-tabs {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
}
`;

fs.writeFileSync(path, content);
console.log("Appended mobile css");
