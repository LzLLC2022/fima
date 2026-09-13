const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const startMarker = '<!-- ===================== 자산/부채 입력 모달 ===================== -->';
let startIndex = html.indexOf(startMarker);

if (startIndex === -1) {
  console.log("Could not find start marker");
  process.exit(1);
}

// Find the script tag containing origSwitchTabLab
const origSwitchStr = 'window.origSwitchTabLab = window.switchTab;';
let origSwitchIndex = html.lastIndexOf(origSwitchStr);
let endIndex = html.indexOf('</script>', origSwitchIndex) + '</script>'.length;

if (origSwitchIndex === -1 || endIndex === -1) {
  console.log("Could not find end marker");
  process.exit(1);
}

const before = html.substring(0, startIndex);
const after = html.substring(endIndex);

const newModalAndScript = `
<!-- ===================== 자산/부채 입력 모달 ===================== -->
<div id="assetModalBackdrop" style="display:none; position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.45); align-items:center; justify-content:center;" onclick="if(event.target===this)closeAssetModal()">
  <div style="background:#fff; border-radius:14px; padding:24px; width:540px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.22);">
    <h3 style="font-size:1.05rem; font-weight:700; color:#3d2f7f; margin-bottom:20px; border-bottom:1px solid #e5e1f5; padding-bottom:10px;">📋 자산 및 부채 정보 입력</h3>
    
    <div style="margin-bottom: 24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h4 style="font-size:0.85rem; font-weight:700; color:#4a5568; margin:0;">부동산 자산 (단위: 원)</h4>
        <button type="button" onclick="addRealEstateItem()" style="padding:4px 10px; border:1px solid #c4b5fd; background:#f5f3ff; border-radius:6px; font-size:0.75rem; font-weight:600; color:#5c6ac4; cursor:pointer;">+ 추가</button>
      </div>
      <div id="realEstateList" style="display:flex; flex-direction:column; gap:12px;">
        <!-- 부동산 항목들이 여기에 동적으로 추가됨 -->
      </div>
    </div>

    <div style="margin-bottom: 20px;">
      <h4 style="font-size:0.85rem; font-weight:700; color:#4a5568; margin-bottom:12px;">기타 자산 (단위: 원)</h4>
      <div style="display:flex; flex-direction:column; gap:10px;">
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
  let tempRealEstates = [];

  function openAssetModal() {
    let data = JSON.parse(localStorage.getItem('fimaLabAssets') || '{}');
    
    // 마이그레이션: 기존 단일 부동산 데이터를 배열로 변환
    if (!data.realEstates) {
      if (data.realEstateInv || data.realEstateMkt) {
        data.realEstates = [{
          id: Date.now(),
          type: "기존 부동산",
          date: "",
          inv: data.realEstateInv || 0,
          mkt: data.realEstateMkt || 0
        }];
      } else {
        data.realEstates = [];
      }
    }
    tempRealEstates = JSON.parse(JSON.stringify(data.realEstates));

    document.getElementById('inpAssetFin').value = data.finAsset || 0;
    document.getElementById('inpAssetOther').value = data.otherAsset || 0;
    document.getElementById('inpLiabMort').value = data.liabMort || 0;
    document.getElementById('inpLiabCred').value = data.liabCred || 0;
    document.getElementById('inpLiabOther').value = data.liabOther || 0;
    
    renderRealEstateList();
    document.getElementById('assetModalBackdrop').style.display = 'flex';
  }

  function closeAssetModal() {
    document.getElementById('assetModalBackdrop').style.display = 'none';
  }

  function addRealEstateItem() {
    tempRealEstates.push({
      id: Date.now() + Math.random(),
      type: "",
      date: "",
      inv: 0,
      mkt: 0
    });
    renderRealEstateList();
  }

  function removeRealEstateItem(id) {
    tempRealEstates = tempRealEstates.filter(item => item.id !== id);
    renderRealEstateList();
  }

  function updateRealEstateItem(id, field, value) {
    const item = tempRealEstates.find(item => item.id === id);
    if (item) {
      item[field] = value;
    }
  }

  function renderRealEstateList() {
    const listDiv = document.getElementById('realEstateList');
    listDiv.innerHTML = '';
    
    if (tempRealEstates.length === 0) {
      listDiv.innerHTML = '<div style="font-size:0.75rem; color:#a0aec0; text-align:center; padding:10px; background:#f7fafc; border-radius:6px; border:1px dashed #cbd5e0;">등록된 부동산 자산이 없습니다.</div>';
      return;
    }

    tempRealEstates.forEach((item, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.style.cssText = 'background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; position:relative;';
      itemDiv.innerHTML = \`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong style="font-size:0.75rem; color:#2d3748;">부동산 #\${index + 1}</strong>
          <button type="button" onclick="removeRealEstateItem(\${item.id})" style="background:none; border:none; color:#e53e3e; font-size:0.75rem; cursor:pointer; font-weight:600;">삭제</button>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
          <div>
            <label style="font-size:0.7rem; color:#718096; margin-bottom:4px; display:block;">구분 (아파트/상가 등)</label>
            <input type="text" onchange="updateRealEstateItem(\${item.id}, 'type', this.value)" value="\${item.type || ''}" style="width:100%; padding:6px; border:1px solid #e2e8f0; border-radius:4px; font-size:0.75rem;" placeholder="예: 아파트" />
          </div>
          <div>
            <label style="font-size:0.7rem; color:#718096; margin-bottom:4px; display:block;">매입시기</label>
            <input type="date" onchange="updateRealEstateItem(\${item.id}, 'date', this.value)" value="\${item.date || ''}" style="width:100%; padding:6px; border:1px solid #e2e8f0; border-radius:4px; font-size:0.75rem;" />
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <label style="font-size:0.7rem; color:#718096; margin-bottom:4px; display:block;">매입가격 (투자원금)</label>
            <input type="number" onchange="updateRealEstateItem(\${item.id}, 'inv', Number(this.value))" value="\${item.inv || 0}" style="width:100%; padding:6px; border:1px solid #e2e8f0; border-radius:4px; font-size:0.75rem;" />
          </div>
          <div>
            <label style="font-size:0.7rem; color:#718096; margin-bottom:4px; display:block;">현재가격</label>
            <input type="number" onchange="updateRealEstateItem(\${item.id}, 'mkt', Number(this.value))" value="\${item.mkt || 0}" style="width:100%; padding:6px; border:1px solid #e2e8f0; border-radius:4px; font-size:0.75rem;" />
          </div>
        </div>
      \`;
      listDiv.appendChild(itemDiv);
    });
  }

  function saveAssetModal() {
    let data = JSON.parse(localStorage.getItem('fimaLabAssets') || '{}');
    
    data.realEstates = tempRealEstates;
    
    data.finAsset = Number(document.getElementById('inpAssetFin').value) || 0;
    data.otherAsset = Number(document.getElementById('inpAssetOther').value) || 0;
    data.liabMort = Number(document.getElementById('inpLiabMort').value) || 0;
    data.liabCred = Number(document.getElementById('inpLiabCred').value) || 0;
    data.liabOther = Number(document.getElementById('inpLiabOther').value) || 0;
    
    localStorage.setItem('fimaLabAssets', JSON.stringify(data));
    closeAssetModal();
    updateLabAssets();
  }

  function updateLabAssets() {
    let data = JSON.parse(localStorage.getItem('fimaLabAssets') || '{}');
    
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

    let realEstates = data.realEstates || [];
    if (!data.realEstates && (data.realEstateInv || data.realEstateMkt)) {
      realEstates = [{ inv: data.realEstateInv || 0, mkt: data.realEstateMkt || 0 }];
    }

    let realEstateInv = realEstates.reduce((sum, item) => sum + (Number(item.inv) || 0), 0);
    let realEstateMkt = realEstates.reduce((sum, item) => sum + (Number(item.mkt) || 0), 0);
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

const finalHtml = before + newModalAndScript + after;
fs.writeFileSync('public/fima.html', finalHtml, 'utf8');
console.log("Successfully updated modal and script.");
