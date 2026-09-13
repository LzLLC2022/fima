const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Reorder sections
const assetStart = html.indexOf('<!-- 자산 현황 통합 섹션 -->');
const marketStart = html.indexOf('<!-- 시장 지수 섹션 -->');

if (assetStart !== -1 && marketStart !== -1 && assetStart < marketStart) {
  const assetBlock = html.substring(assetStart, marketStart);
  
  // Remove assetBlock from its current position
  html = html.substring(0, assetStart) + html.substring(marketStart);
  
  // Find where to insert: right before the end of tab-lab.
  // The end of tab-lab is immediately before the next tab starts.
  const nextTabIdx = html.indexOf('<!-- ===================== 거래 조회 탭 ===================== -->');
  // Find the last </div> before nextTabIdx
  const tabLabEnd = html.lastIndexOf('</div>', nextTabIdx - 1);
  
  // Insert assetBlock before tabLabEnd
  html = html.substring(0, tabLabEnd) + '\n      ' + assetBlock + html.substring(tabLabEnd);
}

// 2. Fix Button Text
html = html.replace('자산 및 부채 정보 추가', '자산 및 부채정보 관리');

// 3. Fix Icons
// Asset Status
html = html.replace(
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5c6ac4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>',
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5c6ac4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>'
);
html = html.replace('<h3>⚖️ 자산 현황</h3>', '<h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #2d3748;">자산 현황</h3>');
html = html.replace('⚖️ 자산 현황', '자산 현황'); // Fallback

// Market Index
const oldMarketIcon = '<div style="background: #eef2ff; color: #5c6ac4; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center;">\n              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>\n            </div>';
const newMarketIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5c6ac4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>';
if (html.includes(oldMarketIcon)) {
  html = html.replace(oldMarketIcon, newMarketIcon);
} else {
  // Try regex in case of spacing difference
  html = html.replace(/<div[^>]*>\s*<svg[^>]*>\s*<polyline[^>]*><\/polyline>\s*<polyline[^>]*><\/polyline>\s*<\/svg>\s*<\/div>/g, newMarketIcon);
}
html = html.replace('<h3 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: #4a5568;">시장 지수</h3>', '<h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #2d3748;">시장 지수</h3>');

// 4. Inject Modal & JS
if (!html.includes('openAssetModal() {')) {
  const modalHtml = `
<!-- ===================== 자산/부채 입력 모달 ===================== -->
<div id="assetModalBackdrop" style="display:none; position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.45); align-items:center; justify-content:center;" onclick="if(event.target===this)closeAssetModal()">
  <div style="background:#fff; border-radius:14px; padding:24px; width:440px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.22);">
    <h3 style="font-size:1.05rem; font-weight:700; color:#3d2f7f; margin-bottom:20px; border-bottom:1px solid #e5e1f5; padding-bottom:10px;">📋 자산 및 부채정보 관리</h3>
    
    <div style="margin-bottom: 20px;">
      <h4 style="font-size:0.85rem; font-weight:700; color:#4a5568; margin-bottom:12px;">자산 구성 (단위: 원)</h4>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">부동산 (투자원금)</label><input type="number" id="inpAssetRealEstateInv" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">부동산 (현재 시가평가액)</label><input type="number" id="inpAssetRealEstateMkt" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">금융자산 (예금/적금 등)</label><input type="number" id="inpAssetFin" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">기타자산</label><input type="number" id="inpAssetOther" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
      </div>
      <div style="font-size:0.7rem; color:#a0aec0; margin-top:8px;">* 금융투자자산은 Fima 리포트 탭의 데이터를 자동으로 연동합니다.</div>
    </div>

    <div style="margin-bottom: 20px;">
      <h4 style="font-size:0.85rem; font-weight:700; color:#4a5568; margin-bottom:12px;">부채 구성 (단위: 원)</h4>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">담보대출</label><input type="number" id="inpLiabMort" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">신용대출</label><input type="number" id="inpLiabCred" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
        <div><label style="font-size:0.75rem; color:#718096; margin-bottom:4px; display:block;">기타대출</label><input type="number" id="inpLiabOther" style="width:100%; padding:8px; border:1px solid #e2e8f0; border-radius:6px;" placeholder="0" /></div>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #e5e1f5; padding-top:16px;">
      <button onclick="closeAssetModal()" style="padding:8px 16px; border:1px solid #e2e8f0; background:#fff; border-radius:6px; font-weight:600; color:#4a5568; cursor:pointer;">취소</button>
      <button onclick="saveAssetModal()" style="padding:8px 16px; border:none; background:#5c6ac4; border-radius:6px; font-weight:600; color:#fff; cursor:pointer;">저장</button>
    </div>
  </div>
</div>
<script>
  // --- Lab Asset Dashboard Logic ---
  function openAssetModal() {
    let data = JSON.parse(localStorage.getItem('fimaLabAssets') || '{}');
    document.getElementById('inpAssetRealEstateInv').value = data.realEstateInv || 0;
    document.getElementById('inpAssetRealEstateMkt').value = data.realEstateMkt || 0;
    document.getElementById('inpAssetFin').value = data.finAsset || 0;
    document.getElementById('inpAssetOther').value = data.otherAsset || 0;
    document.getElementById('inpLiabMort').value = data.liabMort || 0;
    document.getElementById('inpLiabCred').value = data.liabCred || 0;
    document.getElementById('inpLiabOther').value = data.liabOther || 0;
    document.getElementById('assetModalBackdrop').style.display = 'flex';
  }

  function closeAssetModal() {
    document.getElementById('assetModalBackdrop').style.display = 'none';
  }

  function saveAssetModal() {
    let data = {
      realEstateInv: Number(document.getElementById('inpAssetRealEstateInv').value) || 0,
      realEstateMkt: Number(document.getElementById('inpAssetRealEstateMkt').value) || 0,
      finAsset: Number(document.getElementById('inpAssetFin').value) || 0,
      otherAsset: Number(document.getElementById('inpAssetOther').value) || 0,
      liabMort: Number(document.getElementById('inpLiabMort').value) || 0,
      liabCred: Number(document.getElementById('inpLiabCred').value) || 0,
      liabOther: Number(document.getElementById('inpLiabOther').value) || 0
    };
    localStorage.setItem('fimaLabAssets', JSON.stringify(data));
    closeAssetModal();
    updateLabAssets();
  }

  function updateLabAssets() {
    let data = JSON.parse(localStorage.getItem('fimaLabAssets') || '{}');
    
    // Fima 데이터 연동
    let fimaNetInv = 0;
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
    }

    let realEstateInv = Number(data.realEstateInv) || 0;
    let realEstateMkt = Number(data.realEstateMkt) || 0;
    let finAsset = Number(data.finAsset) || 0;
    let otherAsset = Number(data.otherAsset) || 0;

    let liabMort = Number(data.liabMort) || 0;
    let liabCred = Number(data.liabCred) || 0;
    let liabOther = Number(data.liabOther) || 0;

    let netAsset = realEstateInv + fimaNetInv + finAsset + otherAsset;
    let totalAsset = realEstateMkt + fimaMktVal + finAsset + otherAsset;
    let totalLiab = liabMort + liabCred + liabOther;

    if(document.getElementById('labNetAsset')) document.getElementById('labNetAsset').textContent = netAsset.toLocaleString() + '원';
    if(document.getElementById('labTotalAsset')) document.getElementById('labTotalAsset').textContent = totalAsset.toLocaleString() + '원';
    if(document.getElementById('labTotalLiab')) document.getElementById('labTotalLiab').textContent = totalLiab.toLocaleString() + '원';

    if(document.getElementById('txtAssetRealEstate')) document.getElementById('txtAssetRealEstate').textContent = realEstateMkt.toLocaleString() + '원';
    if(document.getElementById('txtAssetFima')) document.getElementById('txtAssetFima').textContent = fimaMktVal.toLocaleString() + '원';
    if(document.getElementById('txtAssetFin')) document.getElementById('txtAssetFin').textContent = finAsset.toLocaleString() + '원';
    if(document.getElementById('txtAssetOther')) document.getElementById('txtAssetOther').textContent = otherAsset.toLocaleString() + '원';

    if(document.getElementById('txtLiabMort')) document.getElementById('txtLiabMort').textContent = liabMort.toLocaleString() + '원';
    if(document.getElementById('txtLiabCred')) document.getElementById('txtLiabCred').textContent = liabCred.toLocaleString() + '원';
    if(document.getElementById('txtLiabOther')) document.getElementById('txtLiabOther').textContent = liabOther.toLocaleString() + '원';

    let aTotal = realEstateMkt + fimaMktVal + finAsset + otherAsset;
    if (aTotal === 0) aTotal = 1;
    if(document.getElementById('barAssetRealEstate')) document.getElementById('barAssetRealEstate').style.width = ((realEstateMkt / aTotal) * 100) + '%';
    if(document.getElementById('barAssetFima')) document.getElementById('barAssetFima').style.width = ((fimaMktVal / aTotal) * 100) + '%';
    if(document.getElementById('barAssetFin')) document.getElementById('barAssetFin').style.width = ((finAsset / aTotal) * 100) + '%';
    if(document.getElementById('barAssetOther')) document.getElementById('barAssetOther').style.width = ((otherAsset / aTotal) * 100) + '%';

    let lTotal = totalLiab;
    if (lTotal === 0) lTotal = 1;
    if(document.getElementById('barLiabMort')) document.getElementById('barLiabMort').style.width = ((liabMort / lTotal) * 100) + '%';
    if(document.getElementById('barLiabCred')) document.getElementById('barLiabCred').style.width = ((liabCred / lTotal) * 100) + '%';
    if(document.getElementById('barLiabOther')) document.getElementById('barLiabOther').style.width = ((liabOther / lTotal) * 100) + '%';
  }

  if (typeof window.origSwitchTabLab === 'undefined') {
    window.origSwitchTabLab = window.switchTab;
    window.switchTab = function(tab) {
      if (window.origSwitchTabLab) window.origSwitchTabLab(tab);
      if (tab === 'lab') {
        updateLabAssets();
      }
    };
  }
</script>
`;
  html = html.replace('</body>', modalHtml + '\n</body>');
}

fs.writeFileSync('public/fima.html', html, 'utf8');
