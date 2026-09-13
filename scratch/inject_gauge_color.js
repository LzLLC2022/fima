const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const hookTarget = `        if (document.getElementById('fg-needle')) {
          // 0 is -90deg, 100 is +90deg, 50 is 0deg
          const angle = (currentVal - 50) * 1.8;
          document.getElementById('fg-needle').setAttribute('transform', \`translate(100, 90) rotate(\${angle})\`);
        }`;

const hookRepl = hookTarget + `
        
        // Update Segment Colors
        let rating = 'neutral';
        if (currentVal <= 25) rating = 'extreme fear';
        else if (currentVal <= 45) rating = 'fear';
        else if (currentVal <= 55) rating = 'neutral';
        else if (currentVal <= 75) rating = 'greed';
        else rating = 'extreme greed';
        
        if (typeof updateGaugeColors === 'function') {
           updateGaugeColors(rating);
        }
`;

if (html.includes(hookTarget)) {
   html = html.replace(hookTarget, hookRepl);
   fs.writeFileSync('public/fima.html', html, 'utf8');
   console.log("Hook injected");
} else {
   console.log("Hook target not found");
}
