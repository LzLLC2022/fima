const puppeteer = require('puppeteer');

async function sniffNetwork(url, provider) {
  console.log(`\n--- Sniffing ${provider} ---`);
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  const apiCalls = [];
  page.on('response', async response => {
    const req = response.request();
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch' || req.resourceType() === 'document') {
      try {
        const text = await response.text();
        // check if text contains 25 (the value we saw) or '2026.08.14'
        if (text.includes('2026.08.14') || (text.includes('분배금') && text.includes('25'))) {
          apiCalls.push({
            url: response.url(),
            method: req.method(),
            preview: text.substring(0, 300)
          });
        }
      } catch (e) {}
    }
  });
  
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  try {
     const elements = await page.$$('a, button, li, span');
     for (const el of elements) {
       const text = await page.evaluate(el => el.innerText, el);
       if (text && (text.includes('분배금 지급현황') || text.includes('분배금 현황'))) {
         console.log('Clicking on:', text.trim());
         await el.click();
         await new Promise(r => setTimeout(r, 2000));
       }
     }
  } catch (e) {}
  
  console.log(`Found ${apiCalls.length} relevant API calls for ${provider}.`);
  apiCalls.forEach((api, idx) => {
    console.log(`\n[${idx + 1}] URL: ${api.url}`);
    console.log(`Method: ${api.method}`);
    console.log(`Preview: ${api.preview}`);
  });
  
  await browser.close();
}

(async () => {
  await sniffNetwork('https://www.aceetf.co.kr/fund/detail/402970', 'ACE');
})();
