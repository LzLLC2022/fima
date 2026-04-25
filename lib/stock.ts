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

// ─────────────────────────────────────────────────────────────────
// 역사적 시세 / 환율 조회
// ─────────────────────────────────────────────────────────────────

/**
 * 특정 날짜의 종가 조회 (날짜 없으면 현재가 반환)
 * @param ticker - 종목코드(한국) 또는 야후 티커(해외)
 * @param date   - 'YYYY-MM-DD' (없으면 현재가)
 */
export async function getStockPrice(ticker: string, date?: string): Promise<number> {
  if (!ticker) return 0;
  ticker = ticker.toString().trim().toUpperCase();

  if (!date) {
    const v = await getStockInfo(ticker, 'price').catch(() => 0);
    return Number(v) || 0;
  }

  if (isKoreanCode(ticker)) {
    return getNaverHistoricalPrice(ticker.split('.')[0], date);
  } else {
    return getYahooHistoricalClose(ticker, date);
  }
}

/** 네이버: 특정 날짜 이전 가장 최근 거래일의 종가 */
async function getNaverHistoricalPrice(code: string, date: string): Promise<number> {
  const endTs = date.replace(/-/g, '');                       // YYYYMMDD
  const d = new Date(date);
  d.setDate(d.getDate() - 7);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const startTs = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

  const url =
    `https://api.finance.naver.com/siseJson.naver` +
    `?symbol=${code}&requestType=1&startTime=${startTs}&endTime=${endTs}&timeframe=day`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://finance.naver.com',
    },
  });
  if (!res.ok) throw new Error(`Naver siseJson ${code}: HTTP ${res.status}`);

  const text = (await res.text()).trim().replace(/^\uFEFF/, '');
  let rows: any[][];
  try {
    rows = JSON.parse(text);
  } catch {
    rows = JSON.parse(text.replace(/'/g, '"'));
  }

  const dataRows = rows.slice(1).filter((r: any[]) => Array.isArray(r) && r.length >= 5);
  if (!dataRows.length) throw new Error(`Naver siseJson ${code} ${date}: 데이터 없음`);

  // 마지막 행 = 조회 기간 내 가장 최신 거래일 (endTime 이전)
  const close = Number(dataRows[dataRows.length - 1][4]);
  if (!close) throw new Error(`Naver 종가 파싱 실패: ${code} ${date}`);
  return close;
}

/** 야후 파이낸스: 특정 날짜 이전 가장 최근 거래일의 종가 */
async function getYahooHistoricalClose(ticker: string, date: string): Promise<number> {
  const period2 = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000);
  const period1 = period2 - 10 * 86400;   // 10일 전 (주말·공휴일 여유)

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=1d&period1=${period1}&period2=${period2}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo chart ${ticker}: HTTP ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || [];

  // 뒤에서부터 유효한 종가 탐색
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null && closes[i]! > 0) {
      return Math.round(closes[i]! * 100000) / 100000;
    }
  }
  throw new Error(`Yahoo 종가 파싱 실패: ${ticker} ${date}`);
}

/**
 * 특정 날짜의 환율 조회 (KRW/외화 1단위, 날짜 없으면 현재 환율)
 * @param currency - 통화코드 ('USD', 'EUR', 'JPY' 등)
 * @param date     - 'YYYY-MM-DD' (없으면 현재)
 * @returns KRW per 1 unit of currency
 */
export async function getExchangeRate(currency: string, date?: string): Promise<number> {
  const upper = currency.toUpperCase();
  if (upper === 'KRW') return 1;

  // 통화 → 야후 파이낸스 티커 (KRW/외화)
  const tickerMap: Record<string, string> = {
    USD: 'KRW=X',     EUR: 'EURKRW=X',
    JPY: 'JPYKRW=X',  GBP: 'GBPKRW=X',
    HKD: 'HKDKRW=X', CNY: 'CNYKRW=X',
    AUD: 'AUDKRW=X',  CAD: 'CADKRW=X',
    CHF: 'CHFKRW=X',  SGD: 'SGDKRW=X',
    MXN: 'MXNKRW=X',  TWD: 'TWDKRW=X',
    THB: 'THBKRW=X',  INR: 'INRKRW=X',
  };

  const yTicker = tickerMap[upper];
  if (!yTicker) return 1;

  if (!date) {
    const v = await getYahooStockInfo(yTicker, 'price').catch(() => 0);
    return Number(v) || 1;
  }

  return getYahooHistoricalClose(yTicker, date).catch(() => 1);
}
