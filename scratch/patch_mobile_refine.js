const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

// 1. Remove the rogue flex-wrap block in the media query
const rogueBlock = `  .nav-tabs {
    flex-wrap: wrap;
    gap: 0.5rem;
  }`;
if (content.includes(rogueBlock)) {
    content = content.replace(rogueBlock, '');
} else {
    console.error("Could not find rogueBlock");
}

// 2. Enhance the top-nav and nav-tabs in the media query
const mediaQueryTopNav = `  .top-nav {
    flex-wrap: wrap !important;
    height: auto !important;
    padding: 1rem !important;
    gap: 0.5rem;
  }`;
const mediaQueryTopNavReplacement = `  .top-nav {
    flex-wrap: wrap !important;
    height: auto !important;
    padding: 0.5rem 1rem !important;
    gap: 0.5rem;
    justify-content: space-between;
  }
  .nav-brand {
    margin-right: 0 !important;
  }
  .nav-actions {
    margin-left: 0 !important;
  }`;

if (content.includes(mediaQueryTopNav)) {
    content = content.replace(mediaQueryTopNav, mediaQueryTopNavReplacement);
} else {
    console.error("Could not find mediaQueryTopNav");
}

const mediaQueryNavTabs = `  .top-nav .nav-tabs {
    width: 100% !important;
    flex: none !important;
    margin-left: 0 !important;
    overflow-x: auto !important;
    white-space: nowrap !important;
    padding-bottom: 0.5rem;
  }`;
const mediaQueryNavTabsReplacement = `  .top-nav .nav-tabs {
    width: 100% !important;
    flex: none !important;
    flex-wrap: nowrap !important;
    margin-left: 0 !important;
    overflow-x: auto !important;
    white-space: nowrap !important;
    padding-bottom: 0.5rem;
    gap: 1rem !important;
  }`;

if (content.includes(mediaQueryNavTabs)) {
    content = content.replace(mediaQueryNavTabs, mediaQueryNavTabsReplacement);
} else {
    console.error("Could not find mediaQueryNavTabs");
}

// 3. Fix tab-layout height on mobile since top-nav height is variable
const sidebarQuery = `  .tab-layout {
    flex-direction: column !important;
  }`;
const sidebarQueryReplacement = `  .tab-layout {
    flex-direction: column !important;
    height: auto !important;
    flex: 1;
    overflow-y: auto !important;
  }`;

if (content.includes(sidebarQuery)) {
    content = content.replace(sidebarQuery, sidebarQueryReplacement);
} else {
    console.error("Could not find sidebarQuery");
}

fs.writeFileSync(path, content);
console.log("Fixed mobile layout completely");
