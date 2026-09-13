const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  await page.goto('https://www.plusetf.co.kr/product/list', { waitUntil: 'networkidle2' });
  
  // They probably have a search box or input
  // Let's just grab all a tags that go to detail
  const links = await page.$$eval('a', as => as.map(a => ({ href: a.href, text: a.innerText })));
  
  const target = links.find(l => l.text.includes('0018C0') || l.text.includes('위클리') || l.text.includes('고배당주위클리고정'));
  
  console.log(target ? `Target found: ${target.href} | ${target.text}` : 'Target not found in immediate links');
  
  if (!target) {
     // Maybe it requires scrolling or clicking "Load more"
     // We can try to extract all product info if there's a JSON embedded
     const pageContent = await page.content();
     const match = pageContent.match(/0018C0.{0,100}/g);
     console.log('Regex matches for 0018C0:', match);
  }
  
  await browser.close();
})();
