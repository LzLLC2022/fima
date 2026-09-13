const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const regex = /document\.getElementById\('fg-needle'\)\.setAttribute\('transform', `translate\(100, 90\) rotate\(\$\{angle\}\)`\);\s*\}/g;

html = html.replace(regex, (match) => {
   return match + `
        
        // Update Segment Colors
        let rating = 'neutral';
        if (currentVal <= 25) rating = 'extreme fear';
        else if (currentVal <= 45) rating = 'fear';
        else if (currentVal <= 55) rating = 'neutral';
        else if (currentVal <= 75) rating = 'greed';
        else rating = 'extreme greed';
        
        if (typeof updateGaugeColors === 'function') {
           updateGaugeColors(rating);
        }`;
});

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Hook injected via regex');
