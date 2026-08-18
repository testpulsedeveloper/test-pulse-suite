const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldKpiValue = `              <div className="kpi-value">
                {totalBugs}
                {totalBugs > 0 && <span style={{fontSize: '0.8rem', display: 'block', color: 'var(--success-color)'}}>Cerrados = {closedBugs}</span>}
              </div>`;

const newKpiValue = `              <div className="kpi-value" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ lineHeight: '1' }}>{totalBugs}</span>
                {totalBugs > 0 && <span style={{fontSize: '0.9rem', display: 'block', color: 'var(--success-color)', marginTop: '0.5rem', lineHeight: '1'}}>Cerrados = {closedBugs}</span>}
              </div>`;

code = code.replace(oldKpiValue, newKpiValue);

fs.writeFileSync('static/hello-world/src/App.js', code);
