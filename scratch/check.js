const fs = require('fs');
const cp = require('child_process');
const html = fs.readFileSync('public/fima.html', 'utf8');

let startIndex = 0;
let count = 0;
while (true) {
  const start = html.indexOf('<script>', startIndex);
  if (start === -1) break;
  const end = html.indexOf('</script>', start);
  if (end === -1) break;
  
  const jsCode = html.substring(start + 8, end);
  const fn = `scratch/script_${count}.js`;
  fs.writeFileSync(fn, jsCode);
  
  try {
    cp.execSync(`node -c ${fn}`);
  } catch(e) {
    console.log(`Syntax Error in script block ${count}!`);
    console.log(e.message);
  }
  
  count++;
  startIndex = end;
}
console.log('Checked all script blocks.');
