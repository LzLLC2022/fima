/**
 * ============================================================
 * stock.ts — 금융 데이터 조회 함수 모음
 * ============================================================
 *
 * 이 파일의 역할
 * ──────────────
 * 주식 시세·채권 가격·환율·배당금 등 금융 데이터를
 * 외부 API에서 가져오는 함수들을 모아놓은 파일입니다.
 * Google Apps Script(GAS)의 Stock.gs 를 Node.js/fetch로 재구현했습니다.
 *
 * 데이터 출처 (종목 유형별)
 * ──────────────────────────
 *  - 한국 주식 (6자리 숫자 코드, 예: 005930)
 *      → 네이버 금융 실시간 API (polling.finance.naver.com)
 *      → 역사적 종가: api.finance.naver.com/siseJson
 *  - 한국 채권 (ISIN 코드, 예: KR103502G6C4)
 *      → KRX OpenAPI (data-dbg.krx.co.kr) — 환경변수 KRX_AUTH_KEY 필요
 *      → KRX 조회 실패 시: 수익률 커브 기반 채권 가격 계산식으로 폴백
 *  - 해외 주식·ETF·환율 (영문 티커, 예: AAPL, KRW=X)
 *      → Yahoo Finance v8 chart API (query1/query2.finance.yahoo.com)
 *
 * 캐시 구조
 * ─────────
 *  - 국고채 수익률 커브(_ktbYieldCache): 서버 메모리에 1시간(TTL) 캐시
 *    조회 순서: 메모리 캐시 → Yahoo Finance 실시간 → KTB_YIELD_CURVE_FALLBACK 테이블
 *  - 그 외 시세·환율·채권 가격: 캐시 없음 (매 호출마다 외부 API 조회)
 *
 * 파일 구조 (위→아래)
 * ──────────────────
 *  1. isKoreanCode()           — 한국 주식 코드 판별
 *  2. isKoreanBondISIN()       — 한국 채권 ISIN 판별
 *  3. krxBondApiId()           — ISIN → KRX API 엔드포인트 매핑
 *  4. BOND_META                — 채권 메타데이터 테이블 (수동 관리)
 *  5. KTB_YIELD_CURVE_FALLBACK — 국고채 수익률 폴백 테이블
 *  6. fetchKtbYieldCurve()     — Yahoo Finance에서 국고채 수익률 실시간 조회
 *  7. getKtbYieldCurve()       — 수익률 커브 반환 (캐시 포함)
 *  8. interpYield()            — 잔존만기에 대한 수익률 선형보간
 *  9. calcBondPrice()          — 채권 가격 계산 (반기 이표, 연속복리 할인)
 * 10. getKorBondCalcPrice()    — BOND_META 채권의 시가평가 계산가 반환
 * 11. getKrxBondPrice()        — KRX OpenAPI 채권 가격 조회
 * 12. getNaverBondInfo()       — 채권 정보 조회 (가격+이름) [외부 공개]
 * 13. getNaverStockInfo()      — 네이버 금융 한국 주식 실시간 정보
 * 14. getYahooStockInfo()      — Yahoo Finance 해외 주식 실시간 정보
 * 15. resolveItem()            — 조회 결과에서 특정 항목만 추출
 * 16. getStockInfo()           — 메인 진입점: 종목/채권 정보 통합 조회 [외부 공개]
 * 17. get52WeekHighLow()       — 52주 최고가/최저가 조회 [외부 공개]
 * 18. getAnnualDividendPerShare() — 연간 주당 배당금 조회 [외부 공개]
 * 19. getMonthlyDivPerShare()  — 월별 주당 배당금 조회 [외부 공개]
 * 20. getStockPrice()          — 특정 날짜 종가 조회 [외부 공개]
 * 21. getNaverHistoricalPrice() — 네이버 역사적 종가
 * 22. getYahooHistoricalClose() — Yahoo Finance 역사적 종가
 * 23. getExchangeRate()        — 환율 조회 (KRW 기준) [외부 공개]
 *
 * 환경변수 (Vercel 대시보드에서 설정)
 * ──────────────────────────────────
 *  - KRX_AUTH_KEY: KRX OpenAPI 인증키 (없으면 채권 가격을 계산식으로 대체)
 * ============================================================
 */

/**
 * 주어진 코드가 한국 주식 코드인지 판별합니다.
 *
 * 한국 주식 코드 규칙: 6자리 숫자+알파벳 (숫자 포함 필수)
 * 예) '005930' → true (삼성전자), 'AAPL' → false, 'KR103502G6C4' → false(채권ISIN)
 *
 * @param code - 판별할 코드 문자열
 * @returns    - 한국 주식 코드이면 true, 아니면 false
 */
export function isKoreanCode(code: string): boolean {
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
 * 폴백 국고채 수익률 테이블 (Yahoo Finance 조회 실패 시 사용)
 * [잔존만기(월), 연수익률] — 2026-04-30 기준
 */
const KTB_YIELD_CURVE_FALLBACK: [number, number][] = [
  [3,   0.02562],  // 통안채(91일) 대용
  [9,   0.02810],  // ~9개월
  [12,  0.03020],  // 국고채권(1년)
  [24,  0.03459],  // 국고채권(2년)
  [36,  0.03568],  // 국고채권(3년)
  [60,  0.03747],  // 국고채권(5년)
  [120, 0.03888],  // 국고채권(10년)
];

// ── 국고채 실시간 수익률 캐시 ──────────────────────────────────────────────
interface YieldCacheEntry {
  curve: [number, number][];
  fetchedAt: number;
}
let _ktbYieldCache: YieldCacheEntry | null = null;
const KTB_YIELD_CACHE_TTL = 60 * 60 * 1000; // 1시간

/**
 * Yahoo Finance에서 한국 국채 벤치마크 수익률 실시간 조회
 * 심볼: KR1YT=RR / KR2YT=RR / KR3YT=RR / KR5YT=RR / KR10YT=RR
 */
async function fetchKtbYieldCurve(): Promise<[number, number][]> {
  const targets: [number, string][] = [
    [12,  'KR1YT%3DRR'],
    [24,  'KR2YT%3DRR'],
    [36,  'KR3YT%3DRR'],
    [60,  'KR5YT%3DRR'],
    [120, 'KR10YT%3DRR'],
  ];

  const results = await Promise.allSettled(
    targets.map(async ([months, sym]) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept'    : 'application/json',
          'Referer'   : 'https://finance.yahoo.com/',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price !== 'number' || price <= 0) throw new Error('invalid yield');
      return [months, price / 100] as [number, number]; // % → 소수 변환
    })
  );

  const curve: [number, number][] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') curve.push(r.value);
  }
  if (curve.length < 3) throw new Error(`KTB yield fetch insufficient: ${curve.length}/5`);
  curve.sort((a, b) => a[0] - b[0]);
  return curve;
}

/**
 * 국고채 수익률 커브 반환 (1시간 캐시 → Yahoo Finance → 폴백 테이블 순)
 */
async function getKtbYieldCurve(): Promise<[number, number][]> {
  const now = Date.now();
  if (_ktbYieldCache && now - _ktbYieldCache.fetchedAt < KTB_YIELD_CACHE_TTL) {
    return _ktbYieldCache.curve;
  }
  try {
    const curve = await fetchKtbYieldCurve();
    _ktbYieldCache = { curve, fetchedAt: now };
    return curve;
  } catch (_e) {
    // Yahoo Finance 조회 실패 → 폴백 테이블 사용
    return KTB_YIELD_CURVE_FALLBACK;
  }
}

/**
 * 수익률 커브(만기별 금리 테이블)에서 특정 잔존만기에 해당하는 금리를 선형보간합니다.
 *
 * 선형보간이란: 테이블에 없는 만기의 금리를 앞뒤 두 데이터 점 사이를 직선으로 이어
 * 비례적으로 추정하는 방식입니다.
 * 예) 3년(0.03568)과 5년(0.03747) 사이 4년 금리 = 0.03568 + (0.03747-0.03568) × (12/24)
 *
 * @param curve  - [잔존만기(개월), 연수익률(소수)] 쌍의 배열 (만기 오름차순)
 * @param months - 보간 대상 잔존만기(개월)
 * @returns      - 보간된 연수익률(소수), 예: 0.035 = 3.5%
 *                 커브 범위 밖이면 양쪽 끝 값을 그대로 반환
 */
function interpYield(curve: [number, number][], months: number): number {
  if (months <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (months >= last[0]) return last[1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [m0, y0] = curve[i];
    const [m1, y1] = curve[i + 1];
    if (months >= m0 && months <= m1) {
      // 선형보간 공식: y0 + (y1 - y0) × (months - m0) / (m1 - m0)
      return y0 + (y1 - y0) * (months - m0) / (m1 - m0);
    }
  }
  return 0.03;
}

/**
 * 채권의 현재 적정 가격을 계산합니다 (반기 이표채, 연속복리 할인 방식).
 *
 * 채권 가격 = 미래 현금흐름의 현재가치 합계
 *   = Σ (각 쿠폰 지급액 / (1 + 연수익률)^잔여연수)
 *     + 원금 / (1 + 연수익률)^만기까지잔여연수
 *
 * 예시 (국고채 01500-2612, 액면 10,000원, 이율 1.5%, 잔존 7개월):
 *   - 반기 쿠폰 = 10,000 × 0.015 / 2 = 75원
 *   - 2026-06 쿠폰: 75원 / (1.03)^0.5년 = ~73.9원
 *   - 2026-12 쿠폰+원금: 10,075원 / (1.03)^1.0년 = ~9,781원
 *   - 합계 ≈ 9,855원
 *
 * @param couponRate   - 연이율 (소수). 예: 1.5% → 0.015
 * @param maturityDate - 만기일 (Date 객체)
 * @param faceValue    - 액면가. 예: 10000
 * @param annualYield  - 연 할인율(수익률, 소수). 예: 3% → 0.03
 * @returns            - 계산된 채권 가격 (소수점 둘째 자리까지)
 */
function calcBondPrice(
  couponRate: number,
  maturityDate: Date,
  faceValue: number,
  annualYield: number,
): number {
  const now = Date.now();
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
  const semiCoupon = faceValue * couponRate / 2; // 반기 이표액 = 액면가 × 연이율 / 2

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
 * BOND_META에 등록된 국고채의 시가평가 계산가를 반환합니다.
 * KRX에서 거래 내역을 찾지 못했을 때 폴백으로 호출됩니다.
 *
 * 계산 순서:
 *  1. BOND_META에서 해당 ISIN의 쿠폰·만기 정보 조회
 *  2. getKtbYieldCurve()로 현재 수익률 커브 가져오기
 *  3. 잔존만기(개월)에 맞는 금리를 선형보간(interpYield)으로 추출
 *  4. calcBondPrice()로 채권 가격 계산
 *
 * @param isin    - 한국 국고채 ISIN 코드 (예: 'KR103502G6C4')
 * @returns       - 계산된 채권 가격 (액면가 10,000원 기준)
 *                  BOND_META에 없거나 만기 경과 시 0 또는 액면가 반환
 */
async function getKorBondCalcPrice(isin: string): Promise<number> {
  const meta = BOND_META[isin.toUpperCase()];
  if (!meta) return 0;

  const maturityDate = new Date(meta.maturity + 'T00:00:00Z');
  const now = new Date();
  const monthsLeft = (maturityDate.getTime() - now.getTime()) / (30.4375 * 24 * 3600 * 1000);
  if (monthsLeft <= 0) return meta.face ?? 10000; // 만기 경과 시 액면가

  const curve  = await getKtbYieldCurve();
  const yield_ = interpYield(curve, monthsLeft);
  return calcBondPrice(meta.coupon, maturityDate, meta.face ?? 10000, yield_);
}

// ── KRX OpenAPI 채권 가격 조회 ────────────────────────────────────────────────

/**
 * KRX(한국거래소) OpenAPI에서 채권의 종가를 조회합니다.
 * 주말·공휴일에는 최대 7일 전까지 소급하여 가장 최근 거래일 가격을 반환합니다.
 *
 * 조회 흐름:
 *  1. KRX_AUTH_KEY 환경변수 없으면 → 계산가(getKorBondCalcPrice)로 즉시 폴백
 *  2. ISIN 4~5번째 자리로 API 엔드포인트 결정 (krxBondApiId)
 *  3. 오늘부터 최대 7일 전까지 루프:
 *     a. KRX API 호출
 *     b. 응답 목록에 해당 ISIN 없으면 → 계산가로 폴백
 *     c. 종가 파싱 성공 시 반환
 *  4. 7일 모두 거래 없으면 → 계산가로 폴백 (0 반환 가능)
 *
 * @param isin - 한국 채권 ISIN 코드
 * @param date - 'YYYY-MM-DD' 기준일 (없으면 오늘)
 * @returns    - 채권 종가 (원), 조회 실패 시 0
 */
async function getKrxBondPrice(isin: string, date?: string): Promise<number> {
  const isinUpper = isin.toUpperCase();
  const authKey = process.env.KRX_AUTH_KEY;

  // KRX API 키 없으면 계산가로 폴백
  if (!authKey) return await getKorBondCalcPrice(isinUpper);

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
        const calcPrice = await getKorBondCalcPrice(isinUpper);
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
    const calcPrice = await getKorBondCalcPrice(isinUpper);
    if (calcPrice > 0) return calcPrice;
  }
  return 0;
}

// ── 채권 ISIN 정보 조회 (가격 + 이름) ────────────────────────────────────
// KRX OpenAPI 우선 조회, 실패 시 0 반환 (시트 Name 컬럼 값 표시)
/**
 * 한국 채권 ISIN의 현재가와 이름을 조회합니다. [외부 공개 함수]
 * 가격은 KRX OpenAPI → 계산가 순으로 조회합니다.
 * 이름(name)은 항상 빈 문자열('')을 반환합니다 — 시트의 Name 컬럼 값을 우선 사용하기 때문입니다.
 *
 * @param isin    - 한국 채권 ISIN 코드 (예: 'KR103502G6C4')
 * @returns       - { price: 채권 종가(원), name: '' }
 */
export async function getNaverBondInfo(isin: string): Promise<{ price: number; name: string }> {
  const price = await getKrxBondPrice(isin).catch(() => 0);
  return { price, name: '' }; // name은 시트 Name 컬럼 우선 사용
}

async function getNaverBondPrice(isin: string): Promise<number> {
  return getKrxBondPrice(isin).catch(() => 0);
}

/**
 * 네이버 금융 실시간 API로 한국 주식 정보를 조회합니다.
 * polling.finance.naver.com API를 사용합니다.
 *
 * @param code - 한국 주식 6자리 코드 (예: '005930', '005930.KS' 모두 허용)
 * @param item - 조회 항목 (예: 'price', 'name', 'change', 'changepct', 'all')
 *               'all' 또는 생략 시 전체 데이터 객체 반환
 * @returns    - 요청 항목 값 또는 전체 데이터 객체
 *               {name, price, change, changepct, market, yesterday, volume, currency,
 *                high52, low52, high, low, baseDate}
 *
 * 부호 처리: compareToPreviousPrice.code 값으로 등락 방향 결정
 *   '2'·'4' → 상승(+), '5'·'6' → 하락(-), '3' → 보합(0)
 */
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
  const change    = sign * Math.abs(toInt(d.compareToPreviousClosePriceRaw));
  const changepct = sign * Math.abs(toFloat(d.fluctuationsRatioRaw)) / 100;
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

/**
 * Yahoo Finance v8 chart API로 해외 주식·ETF·환율 정보를 조회합니다.
 *
 * @param code - Yahoo Finance 티커 (예: 'AAPL', 'VOO', 'KRW=X')
 * @param item - 조회 항목 (예: 'price', 'name', 'all')
 * @returns    - 요청 항목 값 또는 전체 데이터 객체
 *               {name, price, change, changepct, market, yesterday, volume, currency,
 *                high52, low52, high, low, instrumentType, baseDate}
 *
 * exchangeMap: Yahoo의 거래소 코드를 사람이 읽기 좋은 이름으로 변환합니다.
 *   예) 'NMS' → 'NASDAQ', 'NYQ' → 'NYSE', 'KSC' → 'KOSPI'
 * baseDate: regularMarketTime(Unix 타임스탬프)를 로컬 시간 문자열로 변환합니다.
 */
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

/**
 * 조회 결과 객체에서 특정 항목만 꺼내 반환합니다.
 * getNaverStockInfo·getYahooStockInfo의 공통 후처리 함수입니다.
 *
 * @param data - 전체 데이터 객체
 * @param item - 꺼낼 항목 이름 (예: 'price', 'name')
 *               undefined 또는 'all' → 전체 객체 반환
 * @throws     - 존재하지 않는 항목 이름이면 오류 발생
 */
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

/**
 * 52주 최고가 / 최저가 조회
 * Yahoo Finance v8 chart meta.fiftyTwoWeekHigh/Low 사용
 * - 한국 종목: .KS → .KQ 순으로 시도
 * - 채권 ISIN: {high:0, low:0} 반환
 */
export async function get52WeekHighLow(ticker: string): Promise<{ high: number; low: number }> {
  if (!ticker) return { high: 0, low: 0 };
  ticker = ticker.toString().trim().toUpperCase();
  if (isKoreanBondISIN(ticker)) return { high: 0, low: 0 };

  const candidates: string[] = isKoreanCode(ticker)
    ? [`${ticker.split('.')[0]}.KS`, `${ticker.split('.')[0]}.KQ`]
    : [ticker];

  for (const yticker of candidates) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yticker)}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com/',
        },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) continue;
      const h = Number(meta.fiftyTwoWeekHigh) || 0;
      const l = Number(meta.fiftyTwoWeekLow)  || 0;
      if (h > 0) return { high: h, low: l };
    } catch { /* 다음 후보 시도 */ }
  }
  return { high: 0, low: 0 };
}

/**
 * 최근 1년(trailing 12개월, TTM) 동안의 주당 연간 배당금을 조회합니다.
 * Yahoo Finance v8 chart API의 events=dividends 데이터를 사용합니다.
 *
 * @param ticker - 종목 코드 또는 Yahoo 티커
 *                 한국 6자리 코드는 내부에서 .KS → .KQ 순으로 Yahoo 티커 변환
 * @returns      - 지난 365일 배당금 합계 (주당, 로컬 통화 기준)
 *                 채권 ISIN 또는 조회 실패 시 0 반환
 *
 * TTM 계산 방식:
 *  - 2년치 일봉 데이터를 받아 최근 365일 이내 배당 이벤트만 합산
 *  - 분기 배당(연 4회)·반기 배당(연 2회) 모두 정확히 합산됩니다
 */
export async function getAnnualDividendPerShare(ticker: string): Promise<number> {
  if (!ticker) return 0;
  ticker = ticker.toString().trim().toUpperCase();

  if (isKoreanBondISIN(ticker)) return 0;

  // 야후 티커 후보: 한국 6자리는 .KS → .KQ 순 시도
  const candidates: string[] = isKoreanCode(ticker)
    ? [`${ticker.split('.')[0]}.KS`, `${ticker.split('.')[0]}.KQ`]
    : [ticker];

  const fetchDiv = async (yticker: string): Promise<number> => {
    // v8 chart API에 events=dividends 추가, 2년치 일봉 요청 후 최근 365일만 합산
    // (월봉 1년 range는 분기 배당 등을 누락할 수 있어 일봉 2년으로 개선)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yticker)}?interval=1d&range=2y&events=dividends`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    if (!res.ok) return 0;
    const json = await res.json();
    const events = json?.chart?.result?.[0]?.events?.dividends;
    if (!events) return 0;
    // 최근 365일 이내 배당 이벤트만 합산 (TTM)
    const cutoff = Date.now() / 1000 - 365 * 24 * 3600;
    const total = Object.entries(events as Record<string, { amount: number; date?: number }>)
      .filter(([ts, d]) => {
        const t = d.date ?? Number(ts);
        return t >= cutoff;
      })
      .reduce((s, [, d]) => s + (d.amount || 0), 0);
    return Math.round(total * 10000) / 10000;
  };

  for (const yticker of candidates) {
    try {
      const val = await fetchDiv(yticker);
      if (val > 0) return val;
    } catch {
      // 다음 후보 시도
    }
  }
  return 0;
}

/**
 * Yahoo Finance quoteSummary에서 Forward Dividend Yield(FDW)를 조회합니다.
 * summaryDetail.dividendYield.raw (소수) → 퍼센트(%) 변환하여 반환합니다.
 * 데이터 없거나 배당 없는 종목은 0 반환합니다.
 *
 * @param ticker - 종목 코드 (한국 6자리 또는 Yahoo 티커)
 * @returns      - Forward Dividend Yield (%) 예: 3.30 → 3.30%
 */
export async function getFwdDividendYield(ticker: string): Promise<number> {
  if (!ticker) return 0;
  ticker = ticker.toString().trim().toUpperCase();
  if (isKoreanBondISIN(ticker)) return 0;

  const yticker = isKoreanCode(ticker)
    ? `${ticker.split('.')[0]}.KS`
    : ticker;

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yticker)}?modules=summaryDetail`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    if (!res.ok) return 0;
    const json = await res.json();
    const sd = json?.quoteSummary?.result?.[0]?.summaryDetail;
    if (!sd) return 0;
    const raw = sd.dividendYield?.raw;
    return typeof raw === 'number' && raw > 0 ? Math.round(raw * 10000) / 100 : 0;
  } catch {
    return 0;
  }
}

/**
 * 최근 1년간 종목의 월별 주당 배당금을 조회합니다 (로컬 통화 기준).
 *
 * @param ticker - 종목 코드 또는 Yahoo 티커
 * @returns      - 월별 배당금 맵. 예: { "01": 500, "04": 500, "07": 500, "10": 500 }
 *                 배당이 없는 달은 키가 없습니다.
 *                 채권 ISIN 또는 조회 실패 시 빈 객체 {} 반환
 *
 * 한국 분기/반기 ETF 보정 (+2개월 시프트):
 *  Yahoo Finance는 '기준일(record date)'로 배당을 기록하지만,
 *  실제 투자자에게 지급되는 날은 기준일로부터 약 2개월 후입니다.
 *  예) 6월 기준일 → 8월 지급, 12월 기준일 → 2월 지급
 *  연 4회 이하 배당 한국 종목에 한해 자동으로 2개월 시프트합니다.
 */
export async function getMonthlyDivPerShare(ticker: string): Promise<Record<string, number>> {
  if (!ticker) return {};
  ticker = ticker.toString().trim().toUpperCase();
  if (isKoreanBondISIN(ticker)) return {};

  const candidates: string[] = isKoreanCode(ticker)
    ? [`${ticker.split('.')[0]}.KS`, `${ticker.split('.')[0]}.KQ`]
    : [ticker];

  const fetchMonthly = async (yticker: string): Promise<Record<string, number>> => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yticker)}?interval=1d&range=2y&events=dividends`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
    });
    if (!res.ok) return {};
    const json = await res.json();
    const events = json?.chart?.result?.[0]?.events?.dividends;
    if (!events) return {};

    const now = Date.now() / 1000;
    const cutoff = now - 365 * 24 * 3600;
    const monthly: Record<string, number> = {};
    Object.entries(events as Record<string, { amount: number; date?: number }>).forEach(([ts, d]) => {
      const t = d.date ?? Number(ts);
      if (t < cutoff || t > now) return;
      const mo = String(new Date(t * 1000).getUTCMonth() + 1).padStart(2, '0');
      monthly[mo] = (monthly[mo] || 0) + (d.amount || 0);
    });

    // 한국 분기/반기 ETF 보정:
    // Yahoo Finance는 기준일(record date) 기준으로 배당 이벤트를 저장하지만
    // 실제 지급월(지급일)은 기준일보다 약 +2개월 후임.
    // 예) 6월 기준일 → 8월 지급, 12월 기준일 → 2월 지급
    // 월 4회 이하(분기·반기) 배당 종목에 한해 +2개월 시프트 적용.
    if (isKoreanCode(yticker.replace(/\.(KS|KQ)$/, ''))) {
      const eventCount = Object.keys(monthly).length;
      if (eventCount > 0 && eventCount <= 4) {
        const shifted: Record<string, number> = {};
        for (const [mo, amt] of Object.entries(monthly)) {
          const moNum = parseInt(mo);
          const newMoNum = ((moNum - 1 + 2) % 12) + 1;
          const newMo = String(newMoNum).padStart(2, '0');
          shifted[newMo] = (shifted[newMo] || 0) + amt;
        }
        return shifted;
      }
    }

    return monthly;
  };

  for (const yticker of candidates) {
    try {
      const val = await fetchMonthly(yticker);
      if (Object.keys(val).length > 0) return val;
    } catch { /* try next */ }
  }
  return {};
}

// ─────────────────────────────────────────────────────────────────
// 역사적 시세 / 환율 조회
// ─────────────────────────────────────────────────────────────────

/**
 * 특정 날짜의 종가를 조회합니다. 날짜를 지정하지 않으면 현재가를 반환합니다.
 *
 * @param ticker - 종목코드(한국 6자리) 또는 Yahoo 티커(해외), 또는 채권 ISIN
 * @param date   - 'YYYY-MM-DD' 형식 (생략 시 현재가 반환)
 * @returns      - 해당 날짜의 종가 (조회 실패 시 0)
 *
 * 라우팅:
 *  - 채권 ISIN → getKrxBondPrice (KRX OpenAPI, 최대 7일 소급)
 *  - 한국 주식 + 날짜 → getNaverHistoricalPrice (네이버 siseJson)
 *  - 해외 주식 + 날짜 → getYahooHistoricalClose (Yahoo Finance)
 *  - 날짜 없음 → getStockInfo(ticker, 'price') 현재가
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
 * 네이버 금융 siseJson API로 특정 날짜 이전 가장 최근 거래일의 종가를 조회합니다.
 * 주말·공휴일에는 그 이전 마지막 거래일 종가가 반환됩니다.
 *
 * @param code - 한국 주식 6자리 코드 (점 뒤 suffix 제거 후 사용)
 * @param date - 'YYYY-MM-DD' 기준일
 * @returns    - 해당일 이전 가장 최근 거래일의 종가 (원 단위 정수)
 *
 * 구현 메모:
 *  - startTime: date 기준 14일 전 (충분한 거래일 확보)
 *  - endTime  : date 당일
 *  - 응답 배열의 마지막 유효 행 = 가장 최신 거래일 데이터
 *  - 종가는 인덱스 4번 (배열 형식: [날짜, 시가, 고가, 저가, 종가, 거래량])
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
 * Yahoo Finance v8 chart API로 특정 날짜 이전 가장 최근 거래일의 종가를 조회합니다.
 *
 * @param ticker - Yahoo Finance 티커 (예: 'AAPL', 'KRW=X')
 * @param date   - 'YYYY-MM-DD' 기준일
 * @returns      - 해당일 이전 가장 최근 거래일의 종가 (소수점 5자리까지)
 *
 * 구현 메모:
 *  - period1: date 기준 14일 전 Unix 타임스탬프
 *  - period2: date 다음날 Unix 타임스탬프 (GAS 패턴 — 당일 포함을 위해 +1일)
 *  - query2 → query1 순으로 시도 (가용성 확보)
 *  - 종가 배열(closes)을 뒤에서부터 탐색하여 null이 아닌 첫 번째 값 반환
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
 * 특정 날짜의 환율을 조회합니다 (외화 1단위 = KRW 얼마).
 * Yahoo Finance 환율 티커를 사용합니다.
 *
 * @param currency - 통화코드 (예: 'USD', 'EUR', 'JPY', 'GBP')
 * @param date     - 'YYYY-MM-DD' (생략 시 현재 환율)
 * @returns        - 외화 1단위에 해당하는 KRW 금액
 *                  예) USD → 1달러 = 1,350원이면 1350 반환
 *                  KRW 입력 시 항상 1 반환
 *                  지원하지 않는 통화는 1 반환 (오류 방지)
 *
 * tickerMap: 각 통화코드 → Yahoo Finance 티커 매핑
 *   예) 'USD' → 'KRW=X'  (달러당 원화),  'EUR' → 'EURKRW=X'
 *   Yahoo의 기준통화 표기 방식이 일관하지 않아 수동으로 관리합니다.
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
