const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const regex = /\.then\(function\(data\)\s*\{\s*loading\.style\.display = 'none';([\s\S]*?)setPeriodCard\('labPfDailyPnl', 'labPfDailyPct', s\.daily\);/g;

html = html.replace(regex, (match, inner) => {
  return `.then(function(data) {
      try {
        if (loading) loading.style.display = 'none';${inner}setPeriodCard('labPfDailyPnl', 'labPfDailyPct', s.daily);
      } catch(e) { console.log('Lab PF skipped', e); }`;
});

html = html.replace(
        'if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab);',
        'try { if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab); } catch(e) { console.error("orig switchTab error:", e); }'
);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Fixed via regex');
