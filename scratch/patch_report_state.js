const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldPlanSelect = `{plans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}`;
const newPlanSelect = `{testPlans.map(p => <option key={p.id} value={p.id}>{p.summary}</option>)}`;
code = code.replace(oldPlanSelect, newPlanSelect);

const oldCycleSelect = `{cycles.filter(c => !reportSelectedPlan || c.planId === reportSelectedPlan).map(c =>`;
const newCycleSelect = `{testCycles.filter(c => !reportSelectedPlan || c.planId === reportSelectedPlan).map(c =>`;
code = code.replace(oldCycleSelect, newCycleSelect);

fs.writeFileSync('static/hello-world/src/App.js', code);
