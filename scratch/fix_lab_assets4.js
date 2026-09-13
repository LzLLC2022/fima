const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const targetStr = `    let fimaNetInv = 0;
    let fimaMktVal = 0;
    if (window._lastPfData && window._lastPfData.summary) {
      fimaNetInv = window._lastPfData.summary.netInvestmentKRW || 0;
      fimaMktVal = window._lastPfData.summary.marketValueKRW || 0;
    } else {
      let owner = document.getElementById('navOwnerSelect') ? document.getElementById('navOwnerSelect').value : '';
      if(owner) {
        fetch('/api/portfolio-analysis?owner=' + encodeURIComponent(owner))
          .then(res => res.json())
          .then(d => {
             window._lastPfData = d;
             updateLabAssets();
          }).catch(e => console.log('Portfolio fetch error', e));
      }
    }`;

const replaceStr = `    let fimaNetInv = 0;
    let fimaMktVal = 0;
    if (window._labTotalPfData && window._labTotalPfData.summary) {
      fimaNetInv = window._labTotalPfData.summary.netInvestmentKRW || 0;
      fimaMktVal = window._labTotalPfData.summary.marketValueKRW || 0;
    } else {
      let owner = document.getElementById('navOwnerSelect') ? document.getElementById('navOwnerSelect').value : '';
      if (owner) {
        let reqBody = { owner: owner, accountOwner: 'all' };
        fetch('/api/portfolio-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        })
        .then(res => res.json())
        .then(d => {
           window._labTotalPfData = d;
           updateLabAssets();
        }).catch(e => console.log('Portfolio fetch error', e));
        return;
      }
    }`;

// Wait, I need to account for \r\n line endings.
html = html.replace(/let fimaNetInv = 0;[\s\S]*?\}\s*\}/, replaceStr);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Fixed updateLabAssets logic.');
