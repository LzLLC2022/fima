const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const newLogic = `
  // Hook into switchTab
  if (typeof window.origSwitchTabLab2 === 'undefined') {
    window.origSwitchTabLab2 = window.switchTab;
    window.switchTab = function(tab) {
      if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab);
      if (tab === 'lab') {
        loadFearGreedData();
      }
    };
    
    // 강제 초기 실행 (페이지 로드시 실험실 탭이 기본이거나 새로고침 시 탭 유지 기능 등에 대응)
    setTimeout(() => {
       const activeTab = document.querySelector('.tab-nav.active');
       if (activeTab && activeTab.textContent.includes('실험실')) {
          loadFearGreedData();
       }
    }, 500);
  }
`;

const oldStart = html.indexOf('  // Hook into switchTab');
if (oldStart !== -1) {
  // Replace everything from the hook to the end of script tag
  const endScript = html.indexOf('</script>', oldStart);
  html = html.substring(0, oldStart) + newLogic + '\n' + html.substring(endScript);
  fs.writeFileSync('public/fima.html', html, 'utf8');
  console.log('Fixed hook');
}
