const fs = require('fs');
const lines = fs.readFileSync('public/fima.html', 'utf8').split('\n');
lines.forEach((line, i) => {
  if (line.includes('ovTotalKRW') || line.includes('loadPortfolioData') || line.includes('ovStockTotal') || line.includes('ovCashTotal') || line.includes('ovFundTotal')) {
    console.log(`${i+1}: ${line.trim()}`);
  }
});
