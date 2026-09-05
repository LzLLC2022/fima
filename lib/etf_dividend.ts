export async function getTaxBaseInfo(ticker: string, exDate: string): Promise<{ dividend: number, taxBase: number } | null> {
  const cleanTicker = ticker.split('.')[0].toUpperCase();
  
  // Example mapping for known ETFs to their provider IDs
  const etfMap: Record<string, { provider: string, url: string, fundCd?: string }> = {
    // SOL 팔란티어커버드콜OTM채권혼합
    '0040Y0': { provider: 'SOL', url: 'https://www.soletf.com/ko/fund/etf/211088', fundCd: '211088' },
    '486170': { provider: 'SOL', url: 'https://www.soletf.com/ko/fund/etf/211088', fundCd: '211088' },
    // SOL 팔란티어미국채커버드콜혼합
    '0040X0': { provider: 'SOL', url: 'https://www.soletf.com/ko/fund/etf/211089', fundCd: '211089' },
    // KODEX 미국나스닥100데일리커버드콜OTM
    '480460': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFO6' },
    // KODEX 테슬라커버드콜채권혼합액티브
    '472430': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFM1' },
    // PLUS 고배당주위클리고정커버드콜
    '477920': { provider: 'PLUS', url: 'https://www.plusetf.co.kr/product/detail?n=006382' },
    // KODEX 금융고배당TOP10타겟위클리커버드콜
    '481180': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFP1' },
    // KODEX 200타겟위클리커버드콜
    '482730': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFP4' },
    // TIGER 미국30년국채커버드콜액티브(H)
    '476550': { provider: 'TIGER', url: 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7476550009' },
    // KODEX 미국S&P500
    '379800': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFE4' },
    // KODEX 미국나스닥100
    '379810': { provider: 'KODEX', url: 'https://www.samsungfund.com/etf/product/view.do?id=2ETFE3' },
  };

  const etfInfo = etfMap[cleanTicker];

  try {
    let taxBaseData: any = {};
    try {
      const res = await fetch('https://fima.lim.kr/data/tax_base.json?v=2', { next: { revalidate: 3600 } } as any);
      if (res.ok) {
        taxBaseData = await res.json();
      } else {
        const fallback = await fetch('https://raw.githubusercontent.com/LzLLC2022/fima/main/public/data/tax_base.json?v=2');
        if (fallback.ok) taxBaseData = await fallback.json();
      }
    } catch (e) {
      console.error('Failed to load tax_base.json:', e);
    }

    // JSON 데이터에 해당 종목이 있는지 확인 (새로운 { name, data: {...} } 구조 대응)
    const tickerData = taxBaseData[cleanTicker];
    if (tickerData && tickerData.data) {
      const targetMonth = exDate.substring(0, 7).replace('-', '');
      if (tickerData.data[targetMonth] !== undefined) {
        return tickerData.data[targetMonth]; // { dividend, taxBase }
      }
    } else if (tickerData) {
      // 구버전 구조 호환성 유지 (선택)
      const targetMonth = exDate.substring(0, 7).replace('-', '');
      if (typeof tickerData[targetMonth] === 'number') {
        return { dividend: 0, taxBase: tickerData[targetMonth] };
      }
    }

    // SOL ETF 실시간 API 폴백
    if (etfInfo && etfInfo.provider === 'SOL') {
      try {
        if (etfInfo.fundCd) {
          const url = `https://www.soletf.com/api/etf/pds/dividend/${etfInfo.fundCd}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (res.ok) {
            const data = await res.json();
            if (data && data.items && Array.isArray(data.items)) {
              const targetMonth = exDate.substring(0, 7).replace('-', '');
              const item = data.items.find((i: any) => i.WORK_DT && i.WORK_DT.startsWith(targetMonth));
              if (item) {
                return { 
                  dividend: Number(item.DIVI_AMT) || 0, 
                  taxBase: Number(item.STND_TAX_STND_AMT) || 0 
                };
              }
            }
          }
        }
      } catch (err) {
        console.error(`SOL API fetch error for ${cleanTicker}:`, err);
      }
    }

  } catch (error) {
    console.error(`Failed to fetch tax base for ${cleanTicker}:`, error);
  }
  
  return null;
}
