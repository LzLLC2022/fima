const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const targetFillSelect = `function fillSelect(id, items) {
    const sel = document.getElementById(id);`;

const replaceFillSelect = `function fillSelect(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;`;

const targetFillSelectAll = `function fillSelectWithAll(id, items) {
    const sel = document.getElementById(id);`;

const replaceFillSelectAll = `function fillSelectWithAll(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;`;

html = html.replace(targetFillSelect, replaceFillSelect);
html = html.replace(targetFillSelectAll, replaceFillSelectAll);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log("Successfully added null checks to fillSelect functions.");
