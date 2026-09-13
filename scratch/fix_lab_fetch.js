const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Add window._lastPfData = data; to loadPfAnalysis()
html = html.replace(
  /\}\)\.then\(function\(r\) \{ return r\.json\(\); \}\)\.then\(function\(data\) \{/g,
  '}).then(function(r) { return r.json(); }).then(function(data) {\n      window._lastPfData = data;'
);

// 2. Fix fetch in updateLabAssets
const badFetch = `fetch('/api/portfolio-analysis?owner=' + encodeURIComponent(owner))
          .then(res => res.json())
          .then(d => {
             window._lastPfData = d;
             updateLabAssets();
          }).catch(e => console.log('Portfolio fetch error', e));`;

const goodFetch = `var reqBody = { owner: (typeof currentOwner !== 'undefined' ? currentOwner : 'lim.kr'), accountOwner: owner };
        fetch('/api/portfolio-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        })
          .then(res => res.json())
          .then(d => {
             window._lastPfData = d;
             updateLabAssets();
          }).catch(e => console.log('Portfolio fetch error', e));`;

html = html.replace(badFetch, goodFetch);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log("Successfully fixed fimaNetInv fetch logic.");
