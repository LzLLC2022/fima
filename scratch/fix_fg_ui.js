const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Remove the tab buttons
const tabButtonsHtml = `<div style="display: flex; background: #f7fafc; padding: 4px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <button class="fg-tab active" onclick="switchFgTab('summary')" style="padding: 6px 16px; border: none; background: #fff; border-radius: 6px; font-size: 0.85rem; font-weight: 600; color: #5c6ac4; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: pointer;">요약</button>
            <button class="fg-tab" onclick="switchFgTab('chart')" style="padding: 6px 16px; border: none; background: transparent; border-radius: 6px; font-size: 0.85rem; font-weight: 600; color: #718096; cursor: pointer;">52W Chart</button>
          </div>`;
html = html.replace(tabButtonsHtml, '');

// 2. Change fg-chart-view display: none to block
html = html.replace('<div id="fg-chart-view" style="display: none; padding: 20px 0;">', '<div id="fg-chart-view" style="display: block; padding: 20px 0;">');

// 3. Remove switchFgTab function
const switchFnHtml = `<script>
          function switchFgTab(tab) {
            if (tab === 'summary') {
              document.getElementById('fg-summary-view').style.display = 'flex';
              document.getElementById('fg-chart-view').style.display = 'none';
              document.querySelectorAll('.fg-tab')[0].classList.add('active');
              document.querySelectorAll('.fg-tab')[1].classList.remove('active');
            } else {
              document.getElementById('fg-summary-view').style.display = 'none';
              document.getElementById('fg-chart-view').style.display = 'block';
              document.querySelectorAll('.fg-tab')[0].classList.remove('active');
              document.querySelectorAll('.fg-tab')[1].classList.add('active');
            }
          }
        </script>`;
html = html.replace(switchFnHtml, '');

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Modified UI successfully.');
