const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  console.log('Navigating to Dataroma...');
  await page.goto('https://www.dataroma.com/m/holdings.php?m=BA', { waitUntil: 'networkidle2' });
  
  await page.waitForTimeout(2000);
  const title = await page.title();
  console.log('Page Title:', title);

  const data = await page.evaluate(() => {
    const rows = document.querySelectorAll('#grid tbody tr');
    const items = [];
    for(let i=0; i<Math.min(rows.length, 10); i++) {
      const cols = rows[i].querySelectorAll('td');
      if(cols.length >= 4) {
        items.push({
          ticker: cols[0].innerText.trim(),
          name: cols[1].innerText.trim(),
          percent: cols[2].innerText.trim()
        });
      }
    }
    return items;
  });

  console.log('Data:', data);
  await browser.close();
})();
