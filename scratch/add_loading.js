const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const targetStr = `      let owner = document.getElementById('navOwnerSelect') ? document.getElementById('navOwnerSelect').value : '';
      if (owner) {
        if (window._isFetchingLabData) return;
        window._isFetchingLabData = true;
        let reqBody = { owner: owner, accountOwner: '' };
        fetch('/api/portfolio-analysis', {`;

const replaceStr = `      let owner = document.getElementById('navOwnerSelect') ? document.getElementById('navOwnerSelect').value : '';
      if (owner) {
        if (window._isFetchingLabData) return;
        window._isFetchingLabData = true;
        
        // 로딩 표시
        if(document.getElementById('labNetAsset')) document.getElementById('labNetAsset').textContent = '로딩 중...';
        if(document.getElementById('labTotalAsset')) document.getElementById('labTotalAsset').textContent = '로딩 중...';
        if(document.getElementById('txtAssetFima')) document.getElementById('txtAssetFima').textContent = '로딩 중...';
        
        let reqBody = { owner: owner, accountOwner: '' };
        fetch('/api/portfolio-analysis', {`;

html = html.replace(targetStr, replaceStr);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Added loading text successfully.');
