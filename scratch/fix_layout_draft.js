const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Remove tab buttons
const tabRegex = /<div style="display: flex; background: #f7fafc; padding: 4px; border-radius: 8px; border: 1px solid #e2e8f0;">[\s\S]*?<\/div>/;
html = html.replace(tabRegex, '');

// 2. Change fg-summary-view flex wrap
html = html.replace(
  /<div id="fg-summary-view"[^>]*>/,
  `<div id="fg-summary-view" style="display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between;">`
);

// 3. Change Gauge flex
html = html.replace(
  /<div style="flex: 1; min-width: 300px; display: flex; justify-content: center; position: relative;">/,
  `<div style="flex: 0 0 calc(25% - 20px); min-width: 250px; display: flex; justify-content: center; position: relative;">`
);

// 4. Change History flex
html = html.replace(
  /<div style="flex: 1; min-width: 250px; max-width: 320px;">/,
  `<div style="flex: 0 0 calc(25% - 20px); min-width: 250px; max-width: 320px;">`
);

// 5. Move fg-chart-view inside fg-summary-view
// Find the end of fg-summary-view
// The structure is:
//           </div> <!-- end of history -->
//         </div> <!-- end of fg-summary-view -->
//
//         <div id="fg-chart-view" style="display: block; padding: 20px 0;">
//            ...
//         </div>

const chartRegex = /<\/div>\s*<\/div>\s*<div id="fg-chart-view" style="display: block; padding: 20px 0;">/;
html = html.replace(chartRegex, `  </div>\n          <div id="fg-chart-view" style="flex: 0 0 calc(50% - 20px); min-width: 400px; padding: 20px 0;">`);

// Since we removed a closing div for fg-summary-view and moved the chart inside it, 
// the chart's closing div now closes fg-chart-view. We need one more closing div for fg-summary-view!
// Let's look at the structure again:
// </div> (closes fg-chart-view)
// <script> function switchFgTab ...

const afterChartRegex = /(<\/div>\s*)(<script>\s*function switchFgTab)/;
// Wait, switchFgTab was already removed!
// Let's check what's right after fg-chart-view.
