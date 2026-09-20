const fs = require('fs');

const fimaHtmlPath = 'public/fima.html';
let content = fs.readFileSync(fimaHtmlPath, 'utf8');

const newUi = fs.readFileSync('scratch/new_ui.html', 'utf8');
const newJs = fs.readFileSync('scratch/new_ui_js.html', 'utf8');

// Replace UI (around 2174-2200)
// Search for `<!-- 대가의 포트폴리오 (13F) -->` and `<div id="tab-query" class="tab-content">`
const startIndex = content.indexOf('<!-- 대가의 포트폴리오 (13F) -->');
const endIndex = content.indexOf('<div id="tab-query" class="tab-content">');
if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + newUi + '\n      </div>\n\n    <!-- ===================== 거래 조회 탭 ===================== -->\n    ' + content.substring(endIndex);
}

// Replace Script (from `<script>` that contains `loadGurusPortfolio`)
const scriptStart = content.indexOf('<script>\n  async function loadGurusPortfolio() {');
const scriptEnd = content.indexOf('</body>');
if (scriptStart !== -1 && scriptEnd !== -1) {
  content = content.substring(0, scriptStart) + newJs + '\n' + content.substring(scriptEnd);
}

fs.writeFileSync(fimaHtmlPath, content);
console.log('Replaced successfully.');
