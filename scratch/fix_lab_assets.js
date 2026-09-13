const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// 1. Reorder the sections
const assetStart = html.indexOf('<!-- 자산 현황 통합 섹션 -->');
const marketStart = html.indexOf('<!-- 시장 지수 섹션 -->');
const fearStart = html.indexOf('<!-- 공포·탐욕 지수 섹션 -->');
// Find the end of Fear & Greed section
const fearEnd = html.indexOf('</div>', html.indexOf('</div>', fearStart) + 1000); // It's better to just use regex or a robust search
