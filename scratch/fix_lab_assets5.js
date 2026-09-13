const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const targetStrRegex = /let fimaNetInv = 0;\s*let fimaMktVal = 0;\s*if \(window\._labTotalPfData && window\._labTotalPfData\.summary\) \{[\s\S]*?return;\s*\}\s*\}/;

const replaceStr = `let fimaNetInv = 0;
    let fimaMktVal = 0;
    if (typeof window._labTotalPfData !== 'undefined') {
      fimaNetInv = (window._labTotalPfData && window._labTotalPfData.summary) ? (window._labTotalPfData.summary.netInvestmentKRW || 0) : 0;
      fimaMktVal = (window._labTotalPfData && window._labTotalPfData.summary) ? (window._labTotalPfData.summary.marketValueKRW || 0) : 0;
    } else {
      let owner = document.getElementById('navOwnerSelect') ? document.getElementById('navOwnerSelect').value : '';
      if (owner) {
        if (window._isFetchingLabData) return;
        window._isFetchingLabData = true;
        let reqBody = { owner: owner, accountOwner: '' };
        fetch('/api/portfolio-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        })
        .then(res => res.json())
        .then(d => {
           window._isFetchingLabData = false;
           window._labTotalPfData = d;
           updateLabAssets();
        }).catch(e => {
           console.log('Portfolio fetch error', e);
           window._isFetchingLabData = false;
           window._labTotalPfData = null;
           updateLabAssets();
        });
        return;
      }
    }`;

if (targetStrRegex.test(html)) {
  html = html.replace(targetStrRegex, replaceStr);
  fs.writeFileSync('public/fima.html', html, 'utf8');
  console.log('Fixed updateLabAssets loop and accountOwner filter logic.');
} else {
  console.log('Regex did not match!');
}
