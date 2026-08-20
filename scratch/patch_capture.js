const fs = require('fs');
let content = fs.readFileSync('static/hello-world/src/App.js', 'utf8');

const oldCode = `      video.onloadedmetadata = () => {
        setTimeout(async () => {
          const canvas = document.createElement('canvas');`;
const newCode = `      video.onloadedmetadata = () => {
        video.play().then(() => {}).catch(e => console.error(e));
        setTimeout(async () => {
          const canvas = document.createElement('canvas');`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  content = content.replace(`}, 500);
      };
    } catch(err) {`, `}, 1500);
      };
    } catch(err) {`);
  fs.writeFileSync('static/hello-world/src/App.js', content);
  console.log('Patched handleCaptureScreen');
} else {
  console.log('Could not find old code');
}
