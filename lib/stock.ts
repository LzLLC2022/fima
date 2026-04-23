/**
 * 주식 정보 조회 라이브러리
 * GAS의 Stock.gs를 Node.js fetch로 변환
 * - 한국 종목 (6자리 코드): 네이버 금융 API
 * - 해외 종목 (영문 티커): 야후 파이낸스 v8 API
 */

function isKoreanCode(code: string): boolean {
  const c = code.toString().trim().toUpperCase().split('.')[0];
  return /^[0-9A-Z]{6}$/.test(c) && /\d/.test(c);
}

async function getNaverStockInfo(code: string, item?: string): Promise<any> {
  const cleanCode = code.split('.')[0];
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${cleanCode}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://finance.naver.com',
    },
  });

  if (!res.ok) throw new Error(`네이버 API 실패: ${code} (${res.status})`);

  const json = await res.json();
  const d = json.datas?.[0];
  if (!d) throw new Error(`네이버 응답 데이터 없음: ${code}`);

  const signMap: Record<string, number> = { '2': 1, '4': 1, '5': -1, '6': -1, '3': 0 };
  const sign = signMap[d.compareToPreviousPrice?.code] ?? 0;
  const toInt = (s: any) => parseInt(('' + s).replace(/,/g, ''), 10);
  const toFloat = (s: any) => parseFloat(('' + s).replace(/[^0-9.-]/g, ''));

  const price     = toInt(d.closePriceRaw);
  const change    = sign * toInt(d.compareToPreviousClosePriceRaw);
  const changepct = sign * toFloat(d.fluctuationsRatioRaw) / 100;
  const yesterday = price - change;

  const baseDate = d.localTradedAt
    ? d.localTradedAt.substring(0, 16).replace('T', ' ')
    : new Date().toISOString().slice(0, 16).replace('T', ' ');

  const data = {
    name      : d.stockName,
    price     : price,
    change    : change,
    changepct : changepct,
    market    : d.stockExchangeType?.nameKor || '',
    yesterday : yesterday,
    volume    : toInt(d.accumulatedTradingVolumeRaw),
    currency  : d.currencyType?.code || 'KRW',
    high52    : null,
    low52     : null,
    high      : toInt(d.highPriceRaw),
    low       : toInt(d.lowPriceRaw),
    baseDate  : baseDate,
  };

  return resolveItem(data, item);
}

async function getYahooStockInfo(code: string, item?: string): Promise<any> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=1d`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`야후 API 오류: ${code} (${res.status})`);

  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`야후 응답 데이터 없음: ${code}`);

  const price     = meta.regularMarketPrice;
  const yesterday = meta.chartPreviousClose || meta.previousClose;
  const change    = Math.round((price - yesterday) * 10000) / 10000;
  const changepct = Math.round((change / yesterday) * 10000) / 10000;

  const exchangeMap: Record<string, string> = {
    'NMS': 'NASDAQ', 'NGM': 'NASDAQ', 'NCM': 'NASDAQ',
    'NYQ': 'NYSE',   'NYE': 'NYSE',
    'PCX': 'NYSE ARCA',
    'GER': 'XETRA',  'LSE': 'LSE',
    'KSC': 'KOSPI',  'KOE': 'KOSDAQ',
  };
  const exchangeRaw = meta.exchangeName || '';
  const market = exchangeMap[exchangeRaw] || meta.fullExchangeName || exchangeRaw;

  const dt = new Date(meta.regularMarketTime * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const baseDate = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;

  const data = {
    name          : meta.longName || meta.shortName || meta.symbol,
    price         : price,
    change        : change,
    changepct     : changepct,
    market        : market,
    yesterday     : yesterday,
    volume        : meta.regularMarketVolume,
    currency      : meta.currency,
    high52        : meta.fiftyTwoWeekHigh,
    low52         : meta.fiftyTwoWeekLow,
    high          : meta.regularMarketDayHigh,
    low           : meta.regularMarketDayLow,
    instrumentType: meta.instrumentType,
    baseDate      : baseDate,
  };

  return resolveItem(data, item);
}

function resolveItem(data: Record<string, any>, item?: string): any {
  if (!item || item === 'all') return data;
  if (item in data) return data[item];
  throw new Error(`존재하지 않는 항목: ${item}`);
}

/**
 * 메인 함수: 한국 또는 해외 종목 정보 조회
 * @param code  - 종목코드 (예: "005930", "AAPL")
 * @param item  - 조회 항목 (예: "price", "name", "all")
 */
export async function getStockInfo(code: string, item?: string): Promise<any> {
  if (!code) return null;
  code = code.toString().trim().toUpperCase();

  if (isKoreanCode(code)) {
    return getNaverStockInfo(code, item);
  } else {
    return getYahooStockInfo(code, item);
  }
}
