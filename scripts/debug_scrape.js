const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log("KODEX...");
  await page.goto('https://www.samsungfund.com/etf/product/view.do?id=2ETFP4', { waitUntil: 'networkidle2' });
  let html = await page.content();
  fs.writeFileSync('kodex.html', html);

  console.log("PLUS...");
  await page.goto('https://www.plusetf.co.kr/product/detail?n=006382', { waitUntil: 'networkidle2' });
  html = await page.content();
  fs.writeFileSync('plus.html', html);

  console.log("TIGER...");
  await page.goto('https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7476550009', { waitUntil: 'networkidle2' });
  html = await page.content();
  fs.writeFileSync('tiger.html', html);

  await browser.close();
  console.log("Done");
})();
