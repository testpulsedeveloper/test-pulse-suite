const fs = require('fs');
let code = fs.readFileSync('scratch/App.before_bd9daa5.js', 'utf8');

function findBounds(code, startString) {
    const startIdx = code.indexOf(startString);
    if (startIdx === -1) return null;
    
    const blockStartIdx = code.indexOf('=>', startIdx);
    
    let openIdx = -1;
    let openChar = '';
    let closeChar = '';
    
    for (let i = blockStartIdx + 2; i < code.length; i++) {
        if (code[i] === ' ' || code[i] === '\n') continue;
        if (code[i] === '{') { openIdx = i; openChar = '{'; closeChar = '}'; break; }
        if (code[i] === '(') { openIdx = i; openChar = '('; closeChar = ')'; break; }
        break; 
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

const repBounds = findBounds(code, "const renderConfigTab =");
if (repBounds) {
    fs.writeFileSync('scratch/original_config.js', code.substring(repBounds.start, repBounds.end + 1));
} else {
    console.log("Not found");
}
