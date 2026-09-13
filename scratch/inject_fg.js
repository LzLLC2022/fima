const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Add IDs to Needle and Gauge Val
html = html.replace('<g transform="translate(100, 90) rotate(27)">', '<g id="fg-needle" transform="translate(100, 90) rotate(27)">');
html = html.replace('<div class="gauge-val">65</div>', '<div class="gauge-val" id="fg-gauge-val">65</div>');

// 2. Add IDs to History Rows
html = html.replace(
  '<div class="fg-hist-label">Previous close</div>\n                <div class="fg-hist-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed">66</div>',
  '<div class="fg-hist-label">Previous close</div>\n                <div class="fg-hist-status" id="fg-hist-prev-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed" id="fg-hist-prev-badge">66</div>'
);

html = html.replace(
  '<div class="fg-hist-label">1 week ago</div>\n                <div class="fg-hist-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed">64</div>',
  '<div class="fg-hist-label">1 week ago</div>\n                <div class="fg-hist-status" id="fg-hist-1w-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed" id="fg-hist-1w-badge">64</div>'
);

html = html.replace(
  '<div class="fg-hist-label">1 month ago</div>\n                <div class="fg-hist-status">공포</div>\n              </div>\n              <div class="fg-hist-badge badge-fear">41</div>',
  '<div class="fg-hist-label">1 month ago</div>\n                <div class="fg-hist-status" id="fg-hist-1m-status">공포</div>\n              </div>\n              <div class="fg-hist-badge badge-fear" id="fg-hist-1m-badge">41</div>'
);

html = html.replace(
  '<div class="fg-hist-label">1 year ago</div>\n                <div class="fg-hist-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed">63</div>',
  '<div class="fg-hist-label">1 year ago</div>\n                <div class="fg-hist-status" id="fg-hist-1y-status">탐욕</div>\n              </div>\n              <div class="fg-hist-badge badge-greed" id="fg-hist-1y-badge">63</div>'
);

// 3. Add IDs to Chart Line and Labels
html = html.replace(
  '<polyline points="0.0,112.5',
  '<polyline id="fg-chart-line" points="0.0,112.5'
);

html = html.replace(
  '<div style="position: absolute; bottom: -24px; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 0.75rem; color: #718096; padding: 0 10px;">',
  '<div id="fg-chart-labels" style="position: absolute; bottom: -24px; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 0.75rem; color: #718096; padding: 0 10px;">'
);

// 4. Inject JS Fetch Logic
const fgJsLogic = `
  // --- CNN Fear & Greed Logic ---
  function getFgKorean(rating) {
    if (!rating) return { text: '-', class: 'badge-neutral' };
    const r = rating.toLowerCase();
    if (r === 'extreme fear') return { text: '극단적 공포', class: 'badge-extreme-fear' };
    if (r === 'fear') return { text: '공포', class: 'badge-fear' };
    if (r === 'neutral') return { text: '중립', class: 'badge-neutral' };
    if (r === 'greed') return { text: '탐욕', class: 'badge-greed' };
    if (r === 'extreme greed') return { text: '극단적 탐욕', class: 'badge-extreme-greed' };
    return { text: rating, class: 'badge-neutral' };
  }

  function updateFearGreedRow(periodId, dataObj) {
    if (!dataObj) return;
    const info = getFgKorean(dataObj.rating);
    const val = Math.round(dataObj.score);
    const stEl = document.getElementById(periodId + '-status');
    const bdEl = document.getElementById(periodId + '-badge');
    if (stEl) stEl.textContent = info.text;
    if (bdEl) {
      bdEl.textContent = val;
      bdEl.className = 'fg-hist-badge ' + info.class;
    }
  }

  function loadFearGreedData() {
    fetch('/api/fear-and-greed')
      .then(res => res.json())
      .then(data => {
        if (!data || !data.fear_and_greed) return;
        
        const fg = data.fear_and_greed;
        const currentVal = Math.round(fg.score);
        
        // Update Gauge
        if (document.getElementById('fg-gauge-val')) {
          document.getElementById('fg-gauge-val').textContent = currentVal;
        }
        if (document.getElementById('fg-needle')) {
          // 0 is -90deg, 100 is +90deg, 50 is 0deg
          const angle = (currentVal - 50) * 1.8;
          document.getElementById('fg-needle').setAttribute('transform', \`translate(100, 90) rotate(\${angle})\`);
        }
        
        // Update History
        updateFearGreedRow('fg-hist-prev', fg.previous_close);
        updateFearGreedRow('fg-hist-1w', fg.one_week_ago);
        updateFearGreedRow('fg-hist-1m', fg.one_month_ago);
        updateFearGreedRow('fg-hist-1y', fg.one_year_ago);
        
        // Update Chart
        const histData = data.fear_and_greed_historical?.data;
        if (histData && histData.length > 0) {
          const minX = histData[0].x;
          const maxX = histData[histData.length - 1].x;
          const dx = maxX - minX;
          
          let points = [];
          histData.forEach(pt => {
            const px = dx === 0 ? 0 : ((pt.x - minX) / dx) * 1000;
            // score is y, max=100 min=0, SVG height=250. so 0 score is y=250, 100 score is y=0
            const py = 250 - (pt.y / 100 * 250);
            points.push(\`\${px.toFixed(1)},\${py.toFixed(1)}\`);
          });
          
          if (document.getElementById('fg-chart-line')) {
            document.getElementById('fg-chart-line').setAttribute('points', points.join(' '));
          }
          
          // Labels (Quarterly roughly)
          const lbls = [];
          const numLabels = 4;
          for (let i = 0; i < numLabels; i++) {
            const t = minX + dx * (i / (numLabels - 1));
            const d = new Date(t);
            const mStr = d.toLocaleString('en-US', { month: 'short' });
            lbls.push(\`<span>\${mStr} \${d.getFullYear()}</span>\`);
          }
          if (document.getElementById('fg-chart-labels')) {
            document.getElementById('fg-chart-labels').innerHTML = lbls.join('');
          }
        }
      })
      .catch(err => console.error('Failed to load F&G:', err));
  }

  // Hook into switchTab
  if (typeof window.origSwitchTabLab2 === 'undefined') {
    window.origSwitchTabLab2 = window.switchTab;
    let fgLoaded = false;
    window.switchTab = function(tab) {
      if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab);
      if (tab === 'lab' && !fgLoaded) {
        fgLoaded = true;
        loadFearGreedData();
      }
    };
  }
</script>
`;

if (!html.includes('loadFearGreedData() {')) {
  html = html.replace('</body>', fgJsLogic + '\n</body>');
}

fs.writeFileSync('public/fima.html', html, 'utf8');
