const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const newLogic = `
  // --- CNN Fear & Greed Logic ---
  function getRatingFromScore(score) {
    if (score < 25) return 'extreme fear';
    if (score < 45) return 'fear';
    if (score < 55) return 'neutral';
    if (score < 75) return 'greed';
    return 'extreme greed';
  }

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

  function updateFearGreedRow(periodId, score) {
    if (typeof score !== 'number' || isNaN(score)) return;
    const rating = getRatingFromScore(score);
    const info = getFgKorean(rating);
    const val = Math.round(score);
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
        updateFearGreedRow('fg-hist-1w', fg.previous_1_week);
        updateFearGreedRow('fg-hist-1m', fg.previous_1_month);
        updateFearGreedRow('fg-hist-1y', fg.previous_1_year);
        
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
`;

// Extract old logic and replace
const startMarker = '  // --- CNN Fear & Greed Logic ---';
const endMarker = '  // Hook into switchTab';
const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  html = html.substring(0, startIdx) + newLogic + '\n' + html.substring(endIdx);
}

fs.writeFileSync('public/fima.html', html, 'utf8');
