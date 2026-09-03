const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ETF Mapping
const etfMap = {
  '494300': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFO6' },
  '472170': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFM1' },
  '480460': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFP1' },
  '475230': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFP4' },
  '379800': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFE4' },
  '379810': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFE3' },
  '480310': { provider: 'PLUS', url: 'https://www.plusetf.co.kr/product/detail?n=006382' },
  '476060': { provider: 'TIGER', url: 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7476550009' }
};

async function scrapeKodex(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // KODEX uses a tab for "분배금 정보"
    // In mobile or desktop, the structure varies. Let's try to find the "주당과세표준액" text directly in the table.
    
    // Wait for the table to load
    await page.waitForSelector('table', { timeout: 10000 });
    
    // Evaluate in page context
    const data = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      const taxBaseIndex = ths.findIndex(th => th.textContent.includes('과세표준'));
      const dateIndex = ths.findIndex(th => th.textContent.includes('지급기준'));
      
      if (taxBaseIndex === -1 || dateIndex === -1) return null;
      
      // Find the first data row
      const tbody = ths[0].closest('table').querySelector('tbody');
      if (!tbody) return null;
      
      const rows = tbody.querySelectorAll('tr');
      const results = {};
      
      for (const row of rows) {
        const tds = row.querySelectorAll('td');
        if (tds.length > Math.max(taxBaseIndex, dateIndex)) {
          const dateStr = tds[dateIndex].textContent.trim().replace(/\./g, ''); // 2026.08.31 -> 20260831
          const yyyymm = dateStr.substring(0, 6);
          const taxBaseStr = tds[taxBaseIndex].textContent.trim().replace(/,/g, '');
          const taxBase = parseInt(taxBaseStr, 10);
          
          if (!isNaN(taxBase)) {
            // Keep the most recent mapping for the month
            if (!results[yyyymm]) {
              results[yyyymm] = taxBase;
            }
          }
        }
      }
      return results;
    });
    
    return data;
  } catch (error) {
    console.error(`Error scraping KODEX ${url}:`, error.message);
    return null;
  }
}

async function scrapePlus(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('table', { timeout: 10000 });
    
    const data = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      const taxBaseIndex = ths.findIndex(th => th.textContent.includes('과세표준'));
      const dateIndex = ths.findIndex(th => th.textContent.includes('기준일')); // PLUS uses 기준일
      
      if (taxBaseIndex === -1 || dateIndex === -1) return null;
      
      const tbody = ths[0].closest('table').querySelector('tbody');
      if (!tbody) return null;
      
      const rows = tbody.querySelectorAll('tr');
      const results = {};
      
      for (const row of rows) {
        const tds = row.querySelectorAll('td');
        if (tds.length > Math.max(taxBaseIndex, dateIndex)) {
          const dateStr = tds[dateIndex].textContent.trim().replace(/[\.\-]/g, '');
          const yyyymm = "20" + dateStr.substring(0, 4); // Usually YY.MM.DD
          const taxBaseStr = tds[taxBaseIndex].textContent.trim().replace(/,/g, '');
          const taxBase = parseInt(taxBaseStr, 10);
          
          if (!isNaN(taxBase)) {
            if (!results[yyyymm]) results[yyyymm] = taxBase;
          }
        }
      }
      return results;
    });
    return data;
  } catch (error) {
    console.error(`Error scraping PLUS ${url}:`, error.message);
    return null;
  }
}

async function scrapeTiger(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // TIGER might have a button to show dividends.
    // Let's just look for table headers.
    await page.waitForSelector('table', { timeout: 10000 });
    
    const data = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      const taxBaseIndex = ths.findIndex(th => th.textContent.includes('과세표준'));
      const dateIndex = ths.findIndex(th => th.textContent.includes('지급기준')); 
      
      if (taxBaseIndex === -1 || dateIndex === -1) return null;
      
      const tbody = ths[0].closest('table').querySelector('tbody');
      if (!tbody) return null;
      
      const rows = tbody.querySelectorAll('tr');
      const results = {};
      
      for (const row of rows) {
        const tds = row.querySelectorAll('td');
        if (tds.length > Math.max(taxBaseIndex, dateIndex)) {
          const dateStr = tds[dateIndex].textContent.trim().replace(/[\.\-]/g, ''); 
          const yyyymm = dateStr.length === 6 ? "20" + dateStr.substring(0, 4) : dateStr.substring(0, 6);
          const taxBaseStr = tds[taxBaseIndex].textContent.trim().replace(/,/g, '');
          const taxBase = parseInt(taxBaseStr, 10);
          
          if (!isNaN(taxBase)) {
            if (!results[yyyymm]) results[yyyymm] = taxBase;
          }
        }
      }
      return results;
    });
    return data;
  } catch (error) {
    console.error(`Error scraping TIGER ${url}:`, error.message);
    return null;
  }
}

(async () => {
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

  const finalData = {};

  for (const [ticker, info] of Object.entries(etfMap)) {
    console.log(`Scraping ${info.provider} ETF ${ticker} from ${info.url}...`);
    let result = null;
    
    if (info.provider === 'KODEX') {
      result = await scrapeKodex(page, info.url);
    } else if (info.provider === 'PLUS') {
      result = await scrapePlus(page, info.url);
    } else if (info.provider === 'TIGER') {
      result = await scrapeTiger(page, info.url);
    }
    
    if (result) {
      finalData[ticker] = result;
      console.log(`  -> Successfully extracted data:`, result);
    } else {
      console.log(`  -> Failed to extract data for ${ticker}`);
    }
    
    // Add small delay
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();

  // Save to public/data/tax_base.json
  const publicDataDir = path.join(__dirname, '../public/data');
  if (!fs.existsSync(publicDataDir)) {
    fs.mkdirSync(publicDataDir, { recursive: true });
  }
  
  const outputPath = path.join(publicDataDir, 'tax_base.json');
  
  // Merge with existing if exists to preserve historical data
  let existingData = {};
  if (fs.existsSync(outputPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch(e) {}
  }
  
  for (const ticker of Object.keys(finalData)) {
    if (!existingData[ticker]) existingData[ticker] = {};
    Object.assign(existingData[ticker], finalData[ticker]);
  }

  fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2));
  console.log(`\nSuccessfully saved data to ${outputPath}`);
})();
