const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Go to search page with the query
  await page.goto('https://www.plusetf.co.kr/product/list?query=0018C0', { waitUntil: 'networkidle2' });
  
  const links = await page.$$eval('a', as => as.map(a => ({ href: a.href, text: a.innerText })));
  
  // Filter for product details
  const target = links.filter(l => l.href.includes('/product/detail?n='));
  
  console.log('Search Results:');
  console.log(target);
  
  await browser.close();
})();
