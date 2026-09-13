const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');
html = html.replace(/\r\n/g, '\n'); // Normalize

const target1 = `    }).then(function(r) { return r.json(); }).then(function(data) {
      loading.style.display = 'none';
      if (!data.success) {`;

const repl1 = `    }).then(function(r) { return r.json(); }).then(function(data) {
      try {
        if (loading) loading.style.display = 'none';
        if (!data.success) {
          if (errEl) {
            errEl.textContent   = '오류: ' + (data.error || '알 수 없는 오류');
            errEl.style.display = 'block';
          }
          return;
        }
        if (!data.summary) {
          if (errEl) {
            errEl.textContent   = '데이터가 없습니다.';
            errEl.style.display = 'block';
          }
          return;
        }`;

const target2 = `      setPeriodCard('labPfDailyPnl', 'labPfDailyPct', s.daily);

      // ── 테이블 생성 ──────────────────────────────────────`;

const repl2 = `      setPeriodCard('labPfDailyPnl', 'labPfDailyPct', s.daily);
      } catch (e) {
         console.log('Lab PF DOM missing due to dashboard rework, ignoring UI update.', e);
      }

      // ── 테이블 생성 ──────────────────────────────────────`;

if (html.includes(target1) && html.includes(target2)) {
    html = html.replace(target1, repl1);
    html = html.replace(target2, repl2);
    
    // Also let's fix the hook to use try-catch just in case
    html = html.replace(
        'if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab);',
        'try { if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab); } catch(e) { console.error("orig switchTab error:", e); }'
    );
    
    fs.writeFileSync('public/fima.html', html, 'utf8');
    console.log("Replaced successfully!");
} else {
    console.log("Targets not found.");
}
