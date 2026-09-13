const fs = require('fs');
const lines = fs.readFileSync('public/fima.html', 'utf8').split('\n');
lines.forEach((line, i) => {
  if (line.includes('pfDbgCurNetInv') || line.includes('pfDbgCurVal')) {
    console.log(`${i+1}: ${line.trim()}`);
  }
});
