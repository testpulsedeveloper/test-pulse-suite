const fs = require('fs');
let code = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

function findBounds(code, startString) {
    const startIdx = code.indexOf(startString);
    if (startIdx === -1) return null;
    
    // Find the opening brace or parenthesis
    let openIdx = -1;
    let openChar = '';
    let closeChar = '';
    for(let i=startIdx; i<code.length; i++){
        if(code[i] === '{') { openIdx = i; openChar = '{'; closeChar = '}'; break; }
        if(code[i] === '(') { openIdx = i; openChar = '('; closeChar = ')'; break; }
    }
    
    if (openIdx === -1) return null;
    
    let count = 0;
    let endIdx = -1;
    for (let i = openIdx; i < code.length; i++) {
        if (code[i] === openChar) count++;
        else if (code[i] === closeChar) {
            count--;
            if (count === 0) {
                endIdx = i;
                break;
            }
        }
    }
    
    return { start: startIdx, end: endIdx };
}

const repBounds = findBounds(code, "const renderReportsTab =");
const confBounds = findBounds(code, "const renderConfigTab =");

console.log(JSON.stringify({ repBounds, confBounds }));
