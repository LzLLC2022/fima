const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Add IDs to the SVG elements
html = html.replace(
  '<path d="M 20 90 A 70 70 0 0 1 34 40" fill="none" stroke="#f1f5f9" stroke-width="24" />',
  '<path id="fg-arc-ext-fear" d="M 20 90 A 70 70 0 0 1 34 40" fill="none" stroke="#f1f5f9" stroke-width="24" />'
).replace(
  '<text x="22" y="70" font-size="7" fill="#a0aec0" transform="rotate(-60, 22, 70)" font-weight="600">극단적 공포</text>',
  '<text id="fg-text-ext-fear" x="22" y="70" font-size="7" fill="#a0aec0" transform="rotate(-60, 22, 70)" font-weight="600">극단적 공포</text>'
);

html = html.replace(
  '<path d="M 36 37 A 70 70 0 0 1 76 21" fill="none" stroke="#f1f5f9" stroke-width="24" />',
  '<path id="fg-arc-fear" d="M 36 37 A 70 70 0 0 1 76 21" fill="none" stroke="#f1f5f9" stroke-width="24" />'
).replace(
  '<text x="50" y="32" font-size="7" fill="#a0aec0" transform="rotate(-30, 50, 32)" font-weight="600">공포</text>',
  '<text id="fg-text-fear" x="50" y="32" font-size="7" fill="#a0aec0" transform="rotate(-30, 50, 32)" font-weight="600">공포</text>'
);

html = html.replace(
  '<path d="M 79 20 A 70 70 0 0 1 121 20" fill="none" stroke="#f1f5f9" stroke-width="24" />',
  '<path id="fg-arc-neutral" d="M 79 20 A 70 70 0 0 1 121 20" fill="none" stroke="#f1f5f9" stroke-width="24" />'
).replace(
  '<text x="94" y="16" font-size="7" fill="#a0aec0" font-weight="600">중립</text>',
  '<text id="fg-text-neutral" x="94" y="16" font-size="7" fill="#a0aec0" font-weight="600">중립</text>'
);

html = html.replace(
  '<path d="M 124 21 A 70 70 0 0 1 164 37" fill="none" stroke="#68d391" stroke-width="24" />',
  '<path id="fg-arc-greed" d="M 124 21 A 70 70 0 0 1 164 37" fill="none" stroke="#f1f5f9" stroke-width="24" />'
).replace(
  '<text x="135" y="27" font-size="7" fill="#22543d" transform="rotate(30, 135, 27)" font-weight="700">탐욕</text>',
  '<text id="fg-text-greed" x="135" y="27" font-size="7" fill="#a0aec0" transform="rotate(30, 135, 27)" font-weight="600">탐욕</text>'
);

html = html.replace(
  '<path d="M 166 40 A 70 70 0 0 1 180 90" fill="none" stroke="#f1f5f9" stroke-width="24" />',
  '<path id="fg-arc-ext-greed" d="M 166 40 A 70 70 0 0 1 180 90" fill="none" stroke="#f1f5f9" stroke-width="24" />'
).replace(
  '<text x="175" y="70" font-size="7" fill="#a0aec0" transform="rotate(60, 175, 70)" font-weight="600">극단적 탐욕</text>',
  '<text id="fg-text-ext-greed" x="175" y="70" font-size="7" fill="#a0aec0" transform="rotate(60, 175, 70)" font-weight="600">극단적 탐욕</text>'
);

// 2. Add gauge segment update logic
const newJs = `
  function updateGaugeColors(rating) {
    const segments = ['ext-fear', 'fear', 'neutral', 'greed', 'ext-greed'];
    const colors = {
      'ext-fear': { stroke: '#fc8181', fill: '#9b2c2c' }, // Red
      'fear': { stroke: '#f6ad55', fill: '#9c4221' }, // Orange
      'neutral': { stroke: '#cbd5e0', fill: '#4a5568' }, // Gray
      'greed': { stroke: '#68d391', fill: '#22543d' }, // Green
      'ext-greed': { stroke: '#48bb78', fill: '#1c4532' } // Dark Green
    };
    
    // reset all to inactive
    segments.forEach(seg => {
      const arc = document.getElementById('fg-arc-' + seg);
      const txt = document.getElementById('fg-text-' + seg);
      if (arc) arc.setAttribute('stroke', '#f1f5f9');
      if (txt) {
        txt.setAttribute('fill', '#a0aec0');
        txt.setAttribute('font-weight', '600');
      }
    });
    
    // highlight active
    let activeSeg = '';
    if (rating === 'extreme fear') activeSeg = 'ext-fear';
    else if (rating === 'fear') activeSeg = 'fear';
    else if (rating === 'neutral') activeSeg = 'neutral';
    else if (rating === 'greed') activeSeg = 'greed';
    else if (rating === 'extreme greed') activeSeg = 'ext-greed';
    
    if (activeSeg) {
      const arc = document.getElementById('fg-arc-' + activeSeg);
      const txt = document.getElementById('fg-text-' + activeSeg);
      if (arc) arc.setAttribute('stroke', colors[activeSeg].stroke);
      if (txt) {
        txt.setAttribute('fill', colors[activeSeg].fill);
        txt.setAttribute('font-weight', '700');
      }
    }
  }
`;

// Insert the new logic right before `loadFearGreedData()`
const insertIdx = html.indexOf('function loadFearGreedData() {');
if (insertIdx !== -1) {
  html = html.substring(0, insertIdx) + newJs + '\n  ' + html.substring(insertIdx);
  
  // Also call it inside loadFearGreedData
  const hookTarget = `        if (document.getElementById('fg-needle')) {
          // 0 is -90deg, 100 is +90deg, 50 is 0deg
          const angle = (currentVal - 50) * 1.8;
          document.getElementById('fg-needle').setAttribute('transform', \`translate(100, 90) rotate(\${angle})\`);
        }`;
        
  const hookRepl = hookTarget + `
        
        // Update Segment Colors
        updateGaugeColors(getRatingFromScore(currentVal));`;
        
  html = html.replace(hookTarget, hookRepl);
}

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log("Gauge colors made dynamic!");
