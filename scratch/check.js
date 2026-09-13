const fs = require('fs');
const lines = fs.readFileSync('public/fima.html', 'utf8').split('\n');
let found = false;
lines.forEach((l, i) => {
  if (l.includes('id="labPfAccount"')) {
    console.log(i + 1, l);
    found = true;
  }
});
if (!found) console.log('Not found');
