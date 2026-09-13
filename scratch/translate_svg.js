const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

html = html.replace(/>EXTREME FEAR<\/text>/g, '>극단적 공포</text>');
html = html.replace(/>FEAR<\/text>/g, '>공포</text>');
html = html.replace(/>NEUTRAL<\/text>/g, '>중립</text>');
html = html.replace(/>GREED<\/text>/g, '>탐욕</text>');
html = html.replace(/>EXTREME GREED<\/text>/g, '>극단적 탐욕</text>');

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Texts translated.');
