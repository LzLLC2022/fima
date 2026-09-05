const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 1. 대상 종목 맵핑
// pension/portfolio_config.json 및 기존 맵핑 참조
const etfMap = {
  // KODEX
  '494300': { provider: 'KODEX', id: '2ETFO6', name: 'KODEX 미국나스닥100데일리커버드콜OTM' },
  '472170': { provider: 'KODEX', id: 'TODO', name: 'KODEX 200타겟위클리커버드콜' }, 
  '480460': { provider: 'KODEX', id: 'TODO', name: 'KODEX 미국S&P500타겟위클리커버드콜(합성 H)' },
  '475230': { provider: 'KODEX', id: 'TODO', name: 'KODEX 미국배당+10%프리미엄다우존스' },
  '379800': { provider: 'KODEX', id: '2ETFE4', name: 'KODEX 미국S&P500TR' },
  '379810': { provider: 'KODEX', id: '2ETFE3', name: 'KODEX 미국나스닥100TR' },
  '498410': { provider: 'KODEX', id: '2ETFP1', name: 'KODEX 금융고배당TOP10타겟위클리커버드콜' },
  '459580': { provider: 'KODEX', id: 'TODO', name: 'KODEX CD금리액티브(합성)' },
  '498400': { provider: 'KODEX', id: '2ETFP4', name: 'KODEX 200타겟위클리커버드콜' },
  '475080': { provider: 'KODEX', id: '2ETFM1', name: 'KODEX 테슬라커버드콜채권혼합액티브' },
  // PLUS
  '0018C0': { provider: 'PLUS', id: '006382', name: 'PLUS 고배당주위클리고정커버드콜' },
  // TIGER
  '476060': { provider: 'TIGER', isin: 'KR7476550009', name: 'TIGER 배당프리미엄' }, // 임시 ISIN
  '476550': { provider: 'TIGER', isin: 'KR7476550009', name: 'TIGER 미국30년국채커버드콜액티브(H)' },
  '466940': { provider: 'TIGER', isin: 'KR7476550009', name: 'TIGER 은행고배당플러스TOP10' }, // 임시 ISIN
  // SOL
  '0040Y0': { provider: 'SOL', id: '211088', name: 'SOL 팔란티어커버드콜OTM채권혼합' },
  '0040X0': { provider: 'SOL', id: '211089', name: 'SOL 팔란티어미국채커버드콜혼합' },
  // ACE
  '402970': { provider: 'ACE', id: 'K55101DN4471', name: 'ACE 미국배당다우존스' }
};

async function scrapeProvider(page, ticker, info) {
  try {
    let result = {};
    if (info.provider === 'PLUS') {
      console.log(`[${ticker}] Fetching PLUS...`);
      await page.goto(`https://www.plusetf.co.kr/product/detail?n=${info.id}`, { waitUntil: 'networkidle2' });
      
      result = await page.$$eval('#dividendListBody tr', trs => {
        let data = {};
        trs.forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length >= 4) {
            let dateRaw = tds[0].innerText.trim();
            let date = dateRaw.replace(/\./g, '').substring(0, 6);
            let dividendStr = tds[2].innerText.trim().replace(/,/g, '');
            let taxBaseStr = tds[3].innerText.trim().replace(/,/g, '');
            
            let dividend = parseInt(dividendStr, 10);
            let taxBase = parseInt(taxBaseStr, 10);
            if (date && !isNaN(taxBase) && !isNaN(dividend)) {
              data[date] = { dividend, taxBase };
            }
          }
        });
        return data;
      });
      console.log(`[${ticker}] Extracted data:`, result);

    } else if (info.provider === 'KODEX') {
      console.log(`[${ticker}] Fetching KODEX API...`);
      if (info.id === 'TODO') return {};
      const apiUrl = `https://m.samsungfund.com/api/v1/kodex/divid-info.do?id=${info.id}`;
      try {
        const response = await fetch(apiUrl);
        const json = await response.json();
        if (json && json.dividList) {
          json.dividList.forEach(item => {
             if (item.basicD && item.taxDividA && item.dividA) {
               const date = item.basicD.substring(0, 6);
               const taxBase = parseInt(item.taxDividA, 10);
               const dividend = parseInt(item.dividA, 10);
               if (!isNaN(taxBase) && !isNaN(dividend)) {
                 result[date] = { dividend, taxBase };
               }
             }
          });
        }
      } catch (err) {
        console.error(`[${ticker}] KODEX API Error:`, err.message);
      }
      console.log(`[${ticker}] Extracted data:`, result);
      
    } else if (info.provider === 'TIGER') {
      console.log(`[${ticker}] Fetching TIGER API...`);
      const apiUrl = `https://investments.miraeasset.com/tigeretf/ko/product/search/detail/refDivAjax.ajax?ksdFund=${info.isin}`;
      try {
        const response = await fetch(apiUrl);
        const html = await response.text();
        const trs = html.split(/<\/tr>/i);
        trs.forEach(tr => {
          const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
          if (tds && tds.length >= 4) {
            const dateRaw = tds[0].replace(/<[^>]+>/g, '').trim();
            const dividendStr = tds[2].replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
            const taxBaseStr = tds[3].replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
            const date = dateRaw.replace(/[\.\-]/g, '').substring(0, 6);
            
            const dividend = parseInt(dividendStr, 10);
            const taxBase = parseInt(taxBaseStr, 10);
            if (date && !isNaN(taxBase) && !isNaN(dividend)) {
              result[date] = { dividend, taxBase };
            }
          }
        });
      } catch (err) {
        console.error(`[${ticker}] TIGER API Error:`, err.message);
      }
      console.log(`[${ticker}] Extracted data:`, result);

    } else if (info.provider === 'SOL') {
      console.log(`[${ticker}] Fetching SOL API...`);
      if (info.id.includes('TODO')) return {};
      const apiUrl = `https://www.soletf.com/api/etf/pds/dividend/${info.id}`;
      try {
        const response = await fetch(apiUrl);
        const json = await response.json();
        if (json && json.items) {
          json.items.forEach(item => {
            if (item.WORK_DT && item.WEEK_PRI !== undefined && item.DIVIDEND_PRI !== undefined) {
              const date = item.WORK_DT.substring(0, 6);
              const dividend = parseInt(item.DIVIDEND_PRI, 10);
              const taxBase = parseInt(item.WEEK_PRI, 10);
              if (!isNaN(taxBase) && !isNaN(dividend)) {
                result[date] = { dividend, taxBase };
              }
            }
          });
        }
      } catch (err) {
        console.error(`[${ticker}] SOL API Error:`, err.message);
      }
      console.log(`[${ticker}] Extracted data:`, result);

    } else if (info.provider === 'ACE') {
      console.log(`[${ticker}] Fetching ACE API...`);
      const apiUrl = `https://papi.aceetf.co.kr/api/funds/${info.id}/dividend?page=1`;
      try {
        const response = await fetch(apiUrl);
        const json = await response.json();
        if (json && json.dividendList) {
          json.dividendList.forEach(item => {
            if (item.std_DT && item.tax_PRI !== undefined && item.dividend_PRI !== undefined) {
              const date = item.std_DT.substring(0, 6);
              const dividend = parseInt(item.dividend_PRI, 10);
              const taxBase = parseInt(item.tax_PRI, 10);
              if (!isNaN(taxBase) && !isNaN(dividend)) {
                result[date] = { dividend, taxBase };
              }
            }
          });
        }
      } catch (err) {
        console.error(`[${ticker}] ACE API Error:`, err.message);
      }
      console.log(`[${ticker}] Extracted data:`, result);
    }
    return result;
    return result;
  } catch (err) {
    console.error(`[${ticker}] Error:`, err.message);
    return {};
  }
}

async function scrapeTaxBase() {
  console.log("Starting ETF tax base scraper with Puppeteer...");
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  const finalData = {};
  
  for (const [ticker, info] of Object.entries(etfMap)) {
    console.log(`Scraping ${info.provider} ETF: ${ticker}...`);
    const data = await scrapeProvider(page, ticker, info);
    if (Object.keys(data).length > 0) {
      finalData[ticker] = data;
    }
  }
  
  await browser.close();

  // 데이터 병합 및 저장
  const publicDataDir = path.join(__dirname, '../public/data');
  if (!fs.existsSync(publicDataDir)) fs.mkdirSync(publicDataDir, { recursive: true });
  
  const outputPath = path.join(publicDataDir, 'tax_base.json');
  let existingData = {};
  if (fs.existsSync(outputPath)) {
    try { existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch(e) {}
  }
  
  for (const ticker of Object.keys(etfMap)) {
    if (finalData[ticker]) {
      if (!existingData[ticker] || !existingData[ticker].name) {
        existingData[ticker] = { name: etfMap[ticker].name, data: {} };
      }
      existingData[ticker].name = etfMap[ticker].name; // 항상 최신 이름으로 업데이트
      Object.assign(existingData[ticker].data, finalData[ticker]);
      console.log(`Updated data for ${ticker} (${existingData[ticker].name})`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2));
  console.log(`\nSuccessfully saved data to ${outputPath}`);
    
  // GitHub 자동 푸시
  try {
    console.log('\nCommitting and pushing tax_base.json to GitHub...');
    const { execSync } = require('child_process');
    
    execSync('git add public/data/tax_base.json', { stdio: 'inherit' });
    
    const status = execSync('git status --porcelain public/data/tax_base.json').toString();
    if (status.trim() !== '') {
      const dateStr = new Date().toISOString().split('T')[0];
      execSync(`git commit -m "Update tax_base.json data (${dateStr})"`, { stdio: 'inherit' });
      execSync('git push origin main', { stdio: 'inherit' });
      console.log('Successfully pushed to GitHub!');
    } else {
      console.log('No new changes in tax_base.json to push.');
    }
  } catch (err) {
    console.error('Failed to push to GitHub:', err.message);
  }
}

scrapeTaxBase();
