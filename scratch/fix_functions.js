const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

html = html.replace(
  /function fillSelect\(id, items\) \{\s*const sel = document\.getElementById\(id\);/g,
  `function fillSelect(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;`
);

html = html.replace(
  /function fillSelectWithAll\(id, items\) \{\s*const sel = document\.getElementById\(id\);/g,
  `function fillSelectWithAll(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;`
);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Fixed fillSelect functions');
