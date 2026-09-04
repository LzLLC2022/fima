const fs = require('fs');
const path = require('path');
const https = require('https');

// 사용자(FiMa) 관심 ETF 목록
const etfMap = {
  '494300': { provider: 'KODEX' },
  '472170': { provider: 'KODEX' },
  '480460': { provider: 'KODEX' },
  '475230': { provider: 'KODEX' },
  '379800': { provider: 'KODEX' }, // TR (배당 없음)
  '379810': { provider: 'KODEX' }, // TR (배당 없음)
  '480310': { provider: 'PLUS' },
  '476060': { provider: 'TIGER' }
};

const API_KEY = process.env.KSD_API_KEY;

// HTTPS GET 요청 헬퍼
function fetchApi(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// 간단한 XML 파서 (정규식 활용)
function parseXml(xml) {
  const items = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g);
  if (itemMatches) {
    for (const itemXml of itemMatches) {
      const obj = {};
      const fields = itemXml.match(/<([a-zA-Z0-9]+)>([\s\S]*?)<\/\1>/g);
      if (fields) {
        for (const field of fields) {
          const match = field.match(/<([a-zA-Z0-9]+)>([\s\S]*?)<\/\1>/);
          if (match) obj[match[1]] = match[2].trim();
        }
      }
      items.push(obj);
    }
  }
  return items;
}

async function scrapeTaxBase() {
  const finalData = {};
  
  if (!API_KEY) {
    console.error("KSD_API_KEY environment variable is not set!");
    process.exit(1);
  }
  
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1]; // 최근 2년치 조회

  console.log("Fetching KSD API for dividend information...");

  for (const year of years) {
    // 공공데이터포털(한국예탁결제원) 배당 정보 조회 (엔드포인트는 실제 API 스펙에 맞게 조정 필요)
    // 예시로 getDividendRankN1 (또는 실제 과세표준액 엔드포인트) 사용
    const encodedKey = API_KEY.includes('%') ? API_KEY : encodeURIComponent(API_KEY);
    const url = `https://apis.data.go.kr/B552481/StockSvc/getDividendRankN1?serviceKey=${encodedKey}&year=${year}&numOfRows=10000&pageNo=1`;
    
    try {
      const xml = await fetchApi(url);
      
      // API 키 동기화 전이거나 오류일 경우
      if (xml.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")) {
        console.error("API Key is not yet registered or synced. It usually takes 1-2 hours after generation.");
        process.exit(1);
      }
      
      const items = parseXml(xml);
      console.log(`Year ${year}: fetched ${items.length} records.`);
      
      for (const item of items) {
        // 단축코드(stkCd), 지급기준일(divBaseDt), 과세표준액(taxBaseAmt / divAmt 등 실제 필드명에 맞게 변경)
        const ticker = item.stkCd || item.shotnIsin || (item.isinCd ? item.isinCd.substring(3, 9) : null);
        
        if (ticker && etfMap[ticker]) {
          if (!finalData[ticker]) finalData[ticker] = {};
          
          let yyyymm = (item.divBaseDt || item.recordDate || item.basDt || "").substring(0, 6);
          if (!yyyymm && (item.setaccMmdd || item.setaccMm)) {
            const mm = (item.setaccMmdd || item.setaccMm).substring(0, 2);
            yyyymm = `${year}${mm}`;
          }
          // 실제 과세표준액을 제공하는 필드가 없다면 배당금(divAmt) 필드값 사용
          const taxBaseStr = item.taxBaseAmt || item.divAmt || item.cashDivAmt || item.divAmtPerStk || "0"; 
          const taxBase = parseInt(taxBaseStr, 10);
          
          if (yyyymm && !isNaN(taxBase)) {
            finalData[ticker][yyyymm] = taxBase;
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching year ${year}:`, err.message);
    }
  }

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
      if (!existingData[ticker]) existingData[ticker] = {};
      Object.assign(existingData[ticker], finalData[ticker]);
      console.log(`Updated data for ${ticker}:`, finalData[ticker]);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(existingData, null, 2));
  console.log(`\nSuccessfully saved data to ${outputPath}`);
}

scrapeTaxBase();
