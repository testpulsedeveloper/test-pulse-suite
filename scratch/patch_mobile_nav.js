const fs = require('fs');
const path = 'static/hello-world/src/index.css';
let content = fs.readFileSync(path, 'utf8');

// 1. Remove the broken global .top-nav
const brokenTopNav = `  .top-nav {
    flex-wrap: wrap !important;
    height: auto !important;
    padding: 1rem !important;
    gap: 1rem;
  }`;
if (content.includes(brokenTopNav)) {
    content = content.replace(brokenTopNav, '');
} else {
    console.error("Could not find brokenTopNav");
}

// 2. Add proper mobile styling for top-nav and nav-tabs to the media query
const mediaQuery = `@media (max-width: 768px) {`;
const mediaQueryReplacement = `@media (max-width: 768px) {
  .top-nav {
    flex-wrap: wrap !important;
    height: auto !important;
    padding: 1rem !important;
    gap: 0.5rem;
  }
  .top-nav .nav-tabs {
    width: 100% !important;
    flex: none !important;
    margin-left: 0 !important;
    overflow-x: auto !important;
    white-space: nowrap !important;
    padding-bottom: 0.5rem;
  }
  .top-nav .nav-tab {
    height: 40px !important;
  }`;

if (content.includes(mediaQuery)) {
    content = content.replace(mediaQuery, mediaQueryReplacement);
} else {
    console.error("Could not find mediaQuery");
}

fs.writeFileSync(path, content);
console.log("Fixed mobile nav tabs in css");
