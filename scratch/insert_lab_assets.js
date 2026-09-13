const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. HTML 섹션 추가
const assetHtml = `
      <!-- 자산 현황 통합 섹션 -->
      <div class="lab-asset-section" style="background: #fff; padding: 20px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #edf2f7; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid #edf2f7; padding-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5c6ac4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #2d3748;">⚖️ 자산 현황</h3>
          </div>
          <button onclick="openAssetModal()" style="padding: 7px 16px; border: none; background: #ebf4ff; color: #3182ce; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">
            자산 및 부채 정보 추가
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
            <div style="font-size: 0.8rem; color: #718096; font-weight: 600; margin-bottom: 8px;">순자산</div>
            <div id="labNetAsset" style="font-size: 1.4rem; font-weight: 800; color: #1a202c; font-family: monospace;">-</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
            <div style="font-size: 0.8rem; color: #718096; font-weight: 600; margin-bottom: 8px;">총자산</div>
            <div id="labTotalAsset" style="font-size: 1.4rem; font-weight: 800; color: #00a86b; font-family: monospace;">-</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
            <div style="font-size: 0.8rem; color: #718096; font-weight: 600; margin-bottom: 8px;">총부채</div>
            <div id="labTotalLiab" style="font-size: 1.4rem; font-weight: 800; color: #e53e3e; font-family: monospace;">-</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <!-- 자산 구성 -->
          <div>
            <h4 style="font-size: 0.85rem; font-weight: 700; color: #4a5568; margin-bottom: 12px;">자산 구성</h4>
            <div style="height: 12px; border-radius: 6px; display: flex; overflow: hidden; margin-bottom: 12px; background: #edf2f7;">
              <div id="barAssetRealEstate" style="width:0%; background:#4299e1; transition:width 0.4s;"></div>
              <div id="barAssetFima" style="width:0%; background:#48bb78; transition:width 0.4s;"></div>
              <div id="barAssetFin" style="width:0%; background:#ed8936; transition:width 0.4s;"></div>
              <div id="barAssetOther" style="width:0%; background:#9f7aea; transition:width 0.4s;"></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#4299e1;"></div>부동산</div>
                <div id="txtAssetRealEstate" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#48bb78;"></div>금융투자자산</div>
                <div id="txtAssetFima" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#ed8936;"></div>금융자산</div>
                <div id="txtAssetFin" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#9f7aea;"></div>기타자산</div>
                <div id="txtAssetOther" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
            </div>
          </div>
          <!-- 부채 구성 -->
          <div>
            <h4 style="font-size: 0.85rem; font-weight: 700; color: #4a5568; margin-bottom: 12px;">부채 구성</h4>
            <div style="height: 12px; border-radius: 6px; display: flex; overflow: hidden; margin-bottom: 12px; background: #edf2f7;">
              <div id="barLiabMort" style="width:0%; background:#e53e3e; transition:width 0.4s;"></div>
              <div id="barLiabCred" style="width:0%; background:#f56565; transition:width 0.4s;"></div>
              <div id="barLiabOther" style="width:0%; background:#fc8181; transition:width 0.4s;"></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#e53e3e;"></div>담보대출</div>
                <div id="txtLiabMort" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#f56565;"></div>신용대출</div>
                <div id="txtLiabCred" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; font-size:0.75rem; color:#718096; margin-bottom:2px;"><div style="width:8px;height:8px;border-radius:2px;background:#fc8181;"></div>기타대출</div>
                <div id="txtLiabOther" style="font-size:0.9rem; font-weight:700; color:#2d3748; font-family:monospace;">-</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 시장 지수 섹션 -->`;

html = html.replace('<!-- 시장 지수 섹션 -->', assetHtml);

// 2. 모달 추가
const modalHtml = `
<!-- ===================== 자산/부채 입력 모달 ===================== -->
<div id="assetModalBackdrop" style="display:none; position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.45); align-items:center; justify-content:center;" onclick="if(event.target===this)closeAssetModal()">
  <div style="background:#fff; border-radius:14px; padding:24px; width:440px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.22);">
    <h3 style="font-size:1.05rem; font-weight:700; color:#3d2f7f; margin-bottom:20px; border-bottom:1px solid #e5e1f5; padding-bottom:10px;">📋 자산 및 부채 정보 입력</h3>
    
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
</body>`;

html = html.replace('</body>', modalHtml);

// 3. 자바스크립트 로직 추가
const jsLogic = `
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
      // 리포트 탭을 누르지 않아서 데이터가 없다면 임시로 /api/portfolio-analysis 호출해서 가져옴 (백그라운드)
      fetch('/api/portfolio-analysis')
        .then(res => res.json())
        .then(d => {
           window._lastPfData = d;
           // 다시 업데이트
           updateLabAssets();
        }).catch(e => console.log('Portfolio fetch error', e));
    }

    let realEstateInv = Number(data.realEstateInv) || 0;
    let realEstateMkt = Number(data.realEstateMkt) || 0;
    let finAsset = Number(data.finAsset) || 0;
    let otherAsset = Number(data.otherAsset) || 0;

    let liabMort = Number(data.liabMort) || 0;
    let liabCred = Number(data.liabCred) || 0;
    let liabOther = Number(data.liabOther) || 0;

    // 순자산: 부동산 투자금 + Fima 순투자액 + 금융자산 + 기타자산
    let netAsset = realEstateInv + fimaNetInv + finAsset + otherAsset;
    // 총자산: 부동산 시가 + Fima 평가액 + 금융자산 + 기타자산
    let totalAsset = realEstateMkt + fimaMktVal + finAsset + otherAsset;
    // 총부채
    let totalLiab = liabMort + liabCred + liabOther;

    document.getElementById('labNetAsset').textContent = netAsset.toLocaleString() + '원';
    document.getElementById('labTotalAsset').textContent = totalAsset.toLocaleString() + '원';
    document.getElementById('labTotalLiab').textContent = totalLiab.toLocaleString() + '원';

    document.getElementById('txtAssetRealEstate').textContent = realEstateMkt.toLocaleString() + '원';
    document.getElementById('txtAssetFima').textContent = fimaMktVal.toLocaleString() + '원';
    document.getElementById('txtAssetFin').textContent = finAsset.toLocaleString() + '원';
    document.getElementById('txtAssetOther').textContent = otherAsset.toLocaleString() + '원';

    document.getElementById('txtLiabMort').textContent = liabMort.toLocaleString() + '원';
    document.getElementById('txtLiabCred').textContent = liabCred.toLocaleString() + '원';
    document.getElementById('txtLiabOther').textContent = liabOther.toLocaleString() + '원';

    // 비율 계산 (0인 경우 방지)
    let aTotal = realEstateMkt + fimaMktVal + finAsset + otherAsset;
    if (aTotal === 0) aTotal = 1;
    document.getElementById('barAssetRealEstate').style.width = ((realEstateMkt / aTotal) * 100) + '%';
    document.getElementById('barAssetFima').style.width = ((fimaMktVal / aTotal) * 100) + '%';
    document.getElementById('barAssetFin').style.width = ((finAsset / aTotal) * 100) + '%';
    document.getElementById('barAssetOther').style.width = ((otherAsset / aTotal) * 100) + '%';

    let lTotal = totalLiab;
    if (lTotal === 0) lTotal = 1;
    document.getElementById('barLiabMort').style.width = ((liabMort / lTotal) * 100) + '%';
    document.getElementById('barLiabCred').style.width = ((liabCred / lTotal) * 100) + '%';
    document.getElementById('barLiabOther').style.width = ((liabOther / lTotal) * 100) + '%';
  }

  // 기존 switchTab을 감싸서 lab 탭 클릭 시 자동 업데이트
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
</html>`;

if (html.includes('origSwitchTabLab') === false) {
  html = html.replace('</script>\n</body>', jsLogic);
  html = html.replace('</script></body>', jsLogic);
  html = html.replace('</script>\n</html>', jsLogic);
}

fs.writeFileSync('public/fima.html', html, 'utf8');
