const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const targetInv = '<input type="number" onchange="updateRealEstateItem(${item.id}, \'inv\', Number(this.value))" value="${item.inv || 0}"';
const replaceInv = '<input type="text" oninput="formatNumberInput(this)" onchange="updateRealEstateItem(${item.id}, \'inv\', unformatNumber(this.value))" value="${(item.inv || 0).toLocaleString()}"';

const targetMkt = '<input type="number" onchange="updateRealEstateItem(${item.id}, \'mkt\', Number(this.value))" value="${item.mkt || 0}"';
const replaceMkt = '<input type="text" oninput="formatNumberInput(this)" onchange="updateRealEstateItem(${item.id}, \'mkt\', unformatNumber(this.value))" value="${(item.mkt || 0).toLocaleString()}"';

html = html.replace(targetInv, replaceInv);
html = html.replace(targetMkt, replaceMkt);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log("Replaced dynamic inputs successfully.");
