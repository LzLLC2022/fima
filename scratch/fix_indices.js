const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

const mapping = [
  { name: 'KOSPI', ticker: '^KS11' },
  { name: 'KOSDAQ', ticker: '^KQ11' },
  { name: 'S&P 500', ticker: '^GSPC' },
  { name: 'Nasdaq 100', ticker: '^NDX' },
  { name: 'Dow 30', ticker: '^DJI' },
  { name: 'Russell 2000', ticker: '^RUT' },
  { name: 'USD/KRW', ticker: 'KRW=X' },
  { name: 'JPY/KRW', ticker: 'JPYKRW=X' },
  { name: '미국채 10년물', ticker: '^TNX' },
  { name: 'WTI 지수', ticker: 'CL=F' }
];

mapping.forEach(m => {
  const findRegex = new RegExp(`(<div class="index-card")>\\s*<div class="index-name">${m.name}<\/div>`, 'g');
  html = html.replace(findRegex, `$1 data-ticker="${m.ticker}">\n            <div class="index-name">${m.name}</div>`);
});

const script = `
        <script>
          // 시장 지수 실시간 데이터 연동
          (async function loadMarketIndices() {
            const cards = document.querySelectorAll('.index-card[data-ticker]');
            if (!cards.length) return;
            
            const tickers = Array.from(cards).map(c => c.getAttribute('data-ticker')).join(',');
            try {
              const res = await fetch('/api/market-indices?tickers=' + encodeURIComponent(tickers));
              if (!res.ok) return;
              const data = await res.json();
              
              cards.forEach(card => {
                const ticker = card.getAttribute('data-ticker');
                const info = data[ticker];
                if (!info) return;
                
                const valEl = card.querySelector('.index-val');
                const changeEl = card.querySelector('.index-change');
                const sparklineWrap = card.querySelector('.sparkline-wrap');
                
                if (valEl && info.price !== undefined) {
                  const isCurrency = ticker.includes('=X');
                  valEl.textContent = info.price.toLocaleString(undefined, {
                    minimumFractionDigits: isCurrency ? 2 : 2,
                    maximumFractionDigits: 2
                  });
                }
                
                if (changeEl && info.change !== undefined) {
                  const isPos = info.change > 0;
                  changeEl.className = 'index-change ' + (isPos ? 'positive' : (info.change < 0 ? 'negative' : ''));
                  const sign = isPos ? '+' : '';
                  changeEl.textContent = sign + info.change.toFixed(2) + ' (' + sign + info.changePercent.toFixed(2) + '%)';
                }
                
                if (sparklineWrap && info.chart && info.chart.length > 0) {
                  // Generate SVG polyline
                  const chart = info.chart;
                  const min = Math.min(...chart);
                  const max = Math.max(...chart);
                  const range = max - min || 1;
                  
                  const width = 64;
                  const height = 32;
                  const paddingY = 4;
                  const effHeight = height - paddingY * 2;
                  
                  const points = chart.map((val, i) => {
                    const x = (i / (chart.length - 1)) * width;
                    const y = height - paddingY - ((val - min) / range) * effHeight;
                    return \`\${x.toFixed(1)},\${y.toFixed(1)}\`;
                  }).join(' ');
                  
                  const isPos = info.change >= 0;
                  const color = isPos ? '#00a86b' : '#e53e3e';
                  
                  // last point for dot
                  const lastX = width;
                  const lastY = height - paddingY - ((chart[chart.length - 1] - min) / range) * effHeight;
                  
                  sparklineWrap.innerHTML = \`
                    <div class="sparkline-base"></div>
                    <svg viewBox="0 0 \${width} \${height}">
                      <polyline points="\${points}" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      <circle cx="\${lastX}" cy="\${lastY}" r="2" fill="\${color}"/>
                    </svg>
                  \`;
                }
              });
            } catch (e) {
              console.error('Failed to load market indices', e);
            }
          })();
        </script>
`;

if (!html.includes('loadMarketIndices()')) {
  // Insert script right after market-index-container closes
  const insertPos = html.indexOf('</div>\n      </div>\n\n      <!-- 공포·탐욕 지수 섹션 -->');
  if (insertPos !== -1) {
    html = html.substring(0, insertPos) + script + html.substring(insertPos);
  }
}

fs.writeFileSync('public/fima.html', html);
console.log('done');
