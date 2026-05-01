/**
 * 주식 정보 조회 라이브러리
 * GAS의 Stock.gs를 Node.js fetch로 변환
 * - 한국 종목 (6자리 코드): 네이버 금융 API
 * - 한국 채권 ISIN (KR + 10자리): KRX OpenAPI (환경변수 KRX_AUTH_KEY 필요)
 * - 해외 종목 (영문 티커): 야후 파이낸스 v8 API
 */

function isKoreanCode(code: string): boolean {
  const c = code.toString().trim().toUpperCase().split('.')[0];
  // ISIN (12자, KR로 시작)은 제외
  if (c.length === 12 && c.startsWith('KR')) return false;
  return /^[0-9A-Z]{6}$/.test(c) && /\d/.test(c);
}

/** 한국 채권 ISIN 판별 (KR + 10자리 영숫자, 총 12자) */
function isKoreanBondISIN(code: string): boolean {
  return /^KR[A-Z0-9]{10}$/i.test(code.trim());
}

// ── KRX OpenAPI 채권 시장 구분 ────────────────────────────────────────────
// ISIN 4~5번째 자리(분류코드)로 시장 판별
// 10xx: 국채 계열 → 국채전문유통시장 (kts_bydd_trd)
// 20xx/30xx: 국민주택채권, 지방채 → 소액채권시장 (smb_bydd_trd)
// 그 외: 일반채권시장 (bnd_bydd_trd)
function krxBondApiId(isin: string): string {
  const prefix = isin.toUpperCase().slice(2, 6); // KR 다음 4자리
  if (prefix.startsWith('10')) return 'kts_bydd_trd';  // 국채전문유통시장
  if (prefix.startsWith('20') || prefix.startsWith('30')) return 'smb_bydd_trd'; // 소액채권시장
  return 'bnd_bydd_trd'; // 일반채권시장
}

// ── 국고채 시가평가가격 계산 (KRX 미거래 채권 폴백) ─────────────────────────
// KRX kts_bydd_trd에 거래 내역이 없는 국고채(예: 만기 임박 구형채)를
// 채권 가격 공식으로 계산하여 폴백 가격으로 사용합니다.

/**
 * 채권 메타데이터: ISIN → { coupon: 연이율(소수), maturity: 만기일 YYYY-MM-DD, face: 액면가 }
 * - 새 채권 추가 시 이 테이블에 항목을 추가하면 됩니다.
 * - KRX API 미거래 채권 가격 계산 및 만기보유 평가에 사용됩니다.
 */
export const BOND_META: Record<string, { coupon: number; maturity: string; face?: number }> = {
  'KR103502G6C4': { coupon: 0.015, maturity: '2026-12-10', face: 10000 }, // 국고채권 01500-2612(16-8)
};

/**
 * 최종호가수익률 테이블 (ktbinfo.or.kr 기준, 주기적 업데이트 필요)
 * [잔존만기(월), 연수익률] — 선형보간으로 중간값 계산
 * 2026-04-30 기준
 */
const KTB_YIELD_CURVE: [number, number][] = [
  [3,   0.02562],  // 통안채(91일) 대용
  [9,   0.02810],  // ~9개월 (실측: 국고01500-2612 평가수익률)
  [12,  0.03020],  // 국고채권(1년)
  [24,  0.03459],  // 국고채권(2년)
  [36,  0.03568],  // 국고채권(3년)
  [60,  0.03747],  // 국고채권(5년)
  [120, 0.03888],  // 국고채권(10년)
];

/** 잔존만기(개월)로 최종호가수익률 선형보간 */
function interpGovBondYield(months: number): number {
  if (months <= KTB_YIELD_CURVE[0][0]) return KTB_YIELD_CURVE[0][1];
  const last = KTB_YIELD_CURVE[KTB_YIELD_CURVE.length - 1];
  if (months >= last[0]) return last[1];
  for (let i = 0; i < KTB_YIELD_CURVE.length - 1; i++) {
    const [m0, y0] = KTB_YIELD_CURVE[i];
    const [m1, y1] = KTB_YIELD_CURVE[i + 1];
    if (months >= m0 && months <= m1) {
      return y0 + (y1 - y0) * (months - m0) / (m1 - m0);
    }
  }
  return 0.03;
}

/**
 * 채권 가격 계산 (반기 이표, 연속복리 할인)
 * @param couponRate 연이율 (예: 0.015)
 * @param maturityDate 만기일
 * @param faceValue 액면가 (예: 10000)
 * @param annualYield 연 할인율
 */
function calcBondPrice(
  couponRate: number,
  maturityDate: Date,
  faceValue: number,
  annualYield: number,
): number {
  const now = Date.now();
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
  const semiCoupon = faceValue * couponRate / 2;

  // 남은 쿠폰 지급일 계산 (반기, 만기일 기준으로 6개월씩 역산)
  const couponDates: number[] = [];
  const d = new Date(maturityDate);
  while (d.getTime() > now) {
    couponDates.unshift(d.getTime());
    d.setUTCMonth(d.getUTCMonth() - 6);
  }
  if (couponDates.length === 0) return faceValue; // 만기 경과

  let price = 0;
  for (let i = 0; i < couponDates.length; i++) {
    const t = (couponDates[i] - now) / MS_PER_YEAR;
    const cf = (i === couponDates.length - 1)
      ? semiCoupon + faceValue  // 마지막: 쿠폰 + 원금
      : semiCoupon;
    price += cf / Math.pow(1 + annualYield, t);
  }
  return Math.round(price * 100) / 100;
}

/**
 * BOND_META에 등록된 국고채 ISIN의 시가평가 계산가 반환
 * (액면가 10,000원 기준)
 */
function getKorBondCalcPrice(isin: string): number {
  const meta = BOND_META[isin.toUpperCase()];
  if (!meta) return 0;

  const maturityDate = new Date(meta.maturity + 'T00:00:00Z');
  const now = new Date();
  const monthsLeft = (maturityDate.getTime() - now.getTime()) / (30.4375 * 24 * 3600 * 1000);
  if (monthsLeft <= 0) return 10000; // 만기 경과 시 액면가

  const yield_ = interpGovBondYield(monthsLeft);
  return calcBondPrice(meta.coupon, maturityDate, 10000, yield_);
}

// ── KRX OpenAPI 채권 가격 조회 ────────────────────────────────────────────────

async function getKrxBondPrice(isin: string, date?: string): Promise<number> {
  const isinUpper = isin.toUpperCase();
  const authKey = process.env.KRX_AUTH_KEY;

  // KRX API 키 없으면 계산가로 폴백
  if (!authKey) return getKorBondCalcPrice(isinUpper);

  const apiId = krxBondApiId(isinUpper);
  const pad2  = (n: number) => String(n).padStart(2, '0');

  // 기준일 → YYYYMMDD 변환 (없으면 오늘)
  const baseDate = date ? new Date(date + 'T00:00:00Z') : new Date();

  // 최대 7일 전까지 소급 (주말/공휴일 대응)
  let foundInMarket = false; // 시장 목록 자체가 존재했는지 여부
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(baseDate.getTime() - offset * 86400 * 1000);
    const basDd = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;

    const url = `https://data-dbg.krx.co.kr/svc/apis/bon/${apiId}.json`
              + `?AUTH_KEY=${authKey}&basDd=${basDd}`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!res.ok) continue;

      const json = await res.json();
      const items: any[] = json?.OutBlock_1 ?? [];
      if (items.length === 0) continue; // 해당 날짜 거래 없음 → 이전 날 재시도

      foundInMarket = true; // 시장 데이터는 있음 (종목이 없을 수도 있음)
      const bond = items.find((item: any) =>
        String(item.ISU_CD ?? '').trim().toUpperCase() === isinUpper
      );
      if (!bond) {
        // KRX 목록에 없음 → 시가평가 계산가로 폴백
        const calcPrice = getKorBondCalcPrice(isinUpper);
        return calcPrice > 0 ? calcPrice : 0;
      }

      const price = parseFloat(String(bond.CLSPRC ?? '').replace(/,/g, ''));
      if (price > 0) return price;
    } catch (_e) {
      // 네트워크 오류 시 다음 날짜로
    }
  }

  // 7일 모두 거래 없음 (공휴일 연속) → 계산가 폴백
  if (!foundInMarket) {
    const calcPrice = getKorBondCalcPrice(isinUpper);
    if (calcPrice > 0) return calcPrice;
  }
  return 0;
}

// ── 채권 ISIN 정보 조회 (가격 + 이름) ────────────────────────────────────
// KRX OpenAPI 우선 조회, 실패 시 0 반환 (시트 Name 컬럼 값 표시)
export async function getNaverBondInfo(isin: string): Promise<{ price: number; name: string }> {
  const price = await getKrxBondPrice(isin).catch(() => 0);
  return { price, name: '' }; // name은 시트 Name 컬럼 우선 사용
}

async function getNaverBondPrice(isin: string): Promise<number> {
  return getKrxBondPrice(isin).catch(() => 0);
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
 * 메인 함수: 한국 또는 해외 종목/채권 정보 조회
 * @param code  - 종목코드 (예: "005930", "AAPL") 또는 채권 ISIN (예: "KR2032521043")
 * @param item  - 조회 항목 (예: "price", "name", "all")
 */
export async function getStockInfo(code: string, item?: string): Promise<any> {
  if (!code) return null;
  code = code.toString().trim().toUpperCase();

  // 한국 채권 ISIN
  if (isKoreanBondISIN(code)) {
    const price = await getNaverBondPrice(code).catch(() => 0);
    const data = { name: code, price, change: 0, changepct: 0,
                   market: 'KRX채권', currency: 'KRW', baseDate: '' };
    return resolveItem(data, item);
  }

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

  // 한국 채권 ISIN: KRX OpenAPI로 현재가 및 역사적 종가 조회
  if (isKoreanBondISIN(ticker)) {
    return getKrxBondPrice(ticker, date).catch(() => 0);
  }

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

/**
 * 네이버: 특정 날짜 이전 가장 최근 거래일의 종가
 * GAS _getNaverStockHistory 패턴 참조:
 *   startTime = toNaverDate(startDate)
 *   endTime   = toNaverDate(endDate)
 */
async function getNaverHistoricalPrice(code: string, date: string): Promise<number> {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toNaverDate = (d: Date) =>
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;

  const endDt   = new Date(date + 'T00:00:00Z');
  const startDt = new Date(endDt.getTime() - 14 * 86400 * 1000);  // 14일 전

  const url = `https://api.finance.naver.com/siseJson.naver`
    + `?symbol=${code}&requestType=1`
    + `&startTime=${toNaverDate(startDt)}&endTime=${toNaverDate(endDt)}`
    + `&timeframe=day`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://finance.naver.com',
    },
  });
  if (!res.ok) throw new Error(`Naver siseJson ${code}: HTTP ${res.status}`);

  const text = (await res.text()).trim().replace(/^\uFEFF/, '');
  let rows: any[][];
  try { rows = JSON.parse(text); }
  catch (_e) { rows = JSON.parse(text.replace(/'/g, '"')); }

  // 헤더 행 제거 + 유효 데이터 필터 (GAS 패턴)
  const dataRows = rows.filter(
    (r: any[]) => Array.isArray(r) && r.length >= 5 && !isNaN(Number(r[4])) && Number(r[4]) > 0
  );
  if (!dataRows.length) throw new Error(`Naver siseJson ${code} ${date}: 데이터 없음`);

  // 마지막 행 = 조회 기간 내 가장 최신 거래일 종가
  return Number(dataRows[dataRows.length - 1][4]);
}

/**
 * 야후 파이낸스: 특정 날짜 이전 가장 최근 거래일의 종가
 * GAS _getYahooStockHistory 패턴 참조:
 *   period1 = new Date(startDate)            (UTC 자정)
 *   period2 = new Date(endDate) + 1day       (UTC 자정 + 1일)
 */
async function getYahooHistoricalClose(ticker: string, date: string): Promise<number> {
  // GAS 방식: UTC 자정 기준 period1/period2 계산
  const baseMsec = new Date(date + 'T00:00:00Z').getTime();
  const period1  = Math.floor((baseMsec - 14 * 86400 * 1000) / 1000);  // 14일 전
  const period2  = Math.floor((baseMsec + 1  * 86400 * 1000) / 1000);  // +1 day (GAS 패턴)

  const hdrs: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
  };

  const fetchChart = async (host: string): Promise<any> => {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}`
      + `?interval=1d&period1=${period1}&period2=${period2}`;
    const r = await fetch(url, { headers: hdrs });
    if (!r.ok) throw new Error(`Yahoo(${host}) ${ticker}: HTTP ${r.status}`);
    return r.json();
  };

  // query2 → query1 순서로 시도 (GAS는 query1 단독 사용)
  let json: any;
  try {
    json = await fetchChart('query2.finance.yahoo.com');
  } catch (_e1) {
    try {
      json = await fetchChart('query1.finance.yahoo.com');
    } catch (_e2) {
      throw new Error(`Yahoo 조회 실패: ${ticker} ${date}`);
    }
  }

  const closes: (number | null)[] =
    json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];

  // 뒤에서부터 유효한 종가 탐색 (GAS _resolveHistoryItem 패턴)
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = closes[i];
    if (v != null && v > 0) {
      return Math.round(v * 100000) / 100000;
    }
  }
  throw new Error(`Yahoo 종가 없음: ${ticker} ${date}`);
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
