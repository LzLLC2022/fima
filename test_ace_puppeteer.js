const puppeteer = require('puppeteer');

(async () => {
  console.log('Starting Puppeteer for ACE...');
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  await page.goto('https://www.aceetf.co.kr/fund/detail/402970', { waitUntil: 'networkidle2' });
  await page.waitForTimeout(2000);
  
  // Dump all button/span texts that might be dividend
  const texts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter(el => el.innerText && el.innerText.includes('분배금'))
      .map(el => el.innerText.trim());
  });
  console.log('Texts with 분배금:', texts.slice(0, 5));
  
  await browser.close();
})();
