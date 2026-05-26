/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 파일: app/api/portfolio/route.ts
 * 역할: 포트폴리오 현황 계산 API (POST /api/portfolio)
 *
 * ▶ 처리 흐름
 *   1. 구글 스프레드시트(원장)에서 전체 거래 내역을 읽어온다.
 *   2. 기준일/계좌 필터를 적용해 대상 거래를 추린다.
 *   3. 종목별 매수·매도·배당 내역을 집계해 잔고(포지션)를 구한다.
 *   4. 외부 API(야후 파이낸스·네이버 채권)에서 현재가와 환율을 조회한다.
 *   5. 손익(현재가치 - 취득원가)과 수익률을 계산한다.
 *   6. 현금·주식/ETF·펀드/채권으로 분류해 JSON으로 응답한다.
 *
 * ▶ 응답 데이터 구조
 *   {
 *     success       : 성공 여부 (true/false)
 *     cash          : 현금 잔고 목록 (지역별 · 통화별)
 *     stocks        : 주식·ETF 포지션 목록
 *     funds         : 펀드·채권 포지션 목록
 *     totalKRW      : 전체 평가액 합계 (원화)
 *     totalCashKRW  : 현금 합계 (원화)
 *     totalStockKRW : 주식·ETF 합계 (원화)
 *     totalFundKRW  : 펀드·채권 합계 (원화)
 *   }
 *
 * ▶ 각 종목(stocks/funds) 항목의 주요 필드
 *   ticker        : 종목 코드 (예: AAPL, KR000123456)
 *   name          : 종목명
 *   currency      : 거래 통화 (KRW / USD / JPY 등)
 *   quantity      : 현재 보유 수량
 *   avgPrice      : 평균 매입단가 (현지통화)
 *   purchaseAmt   : 총 매입금액 (원화 환산)
 *   currentPrice  : 현재가 (현지통화)
 *   marketValue   : 현재 평가액 (원화 환산)
 *   pnl           : 평가손익 (원화, marketValue - purchaseAmt)
 *   pnlPct        : 수익률 % (현지통화 기준)
 *   divFX / divKRW: 수령한 배당 합계 (현지통화 / 원화)
 *   annualDivFX   : 예상 연간 배당 (현지통화)
 *   annualDivKRW  : 예상 연간 배당 (원화)
 *   maturityEval  : 만기보유 평가 정보 (채권 전용, 해당 없으면 null)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';
import { getStockPrice, getExchangeRate, getNaverBondInfo, BOND_META, getAnnualDividendPerShare } from '@/lib/stock';

/**
 * 한국 채권 ISIN 여부 판별
 * - ISIN(국제증권식별번호)은 'KR'로 시작하는 12자리 코드
 * - 예: KR1234567890 → 채권으로 인식
 * - 채권인 경우 네이버 채권 API에서 이름·만기 정보를 조회한다
 */
function isKoreanBondISIN(ticker: string): boolean {
  return /^KR[A-Z0-9]{10}$/i.test(ticker.trim());
}

/**
 * 채권 만기보유 평가 계산
 *
 * 채권을 만기까지 보유했을 때 받을 수 있는 총 금액을 계산한다.
 * 계산식: 원금(액면가 × 수량) + 남은 쿠폰 합계
 *
 * - BOND_META에 등록된 채권만 계산 가능 (lib/stock.ts 참고)
 * - 쿠폰은 반기(6개월) 지급 기준으로 계산
 * - 이미 만기가 지난 채권은 null 반환
 *
 * @param isin          채권 ISIN 코드 (예: KR1234567890)
 * @param netQty        현재 보유 수량
 * @param purchaseAmtFX 총 매입금액 (현지통화 기준)
 * @returns 만기보유 평가 정보 객체, 또는 해당 없으면 null
 */
function calcMaturityEval(isin: string, netQty: number, purchaseAmtFX: number) {
  const meta = BOND_META[isin.toUpperCase()];
  if (!meta) return null;

  const faceValue   = meta.face ?? 10000;
  const maturityDate = new Date(meta.maturity + 'T00:00:00Z');
  const now          = new Date();

  if (maturityDate <= now) return null; // 이미 만기

  // 남은 쿠폰 지급일 계산 (반기, 만기일 기준으로 6개월씩 역산)
  const couponPerUnit = faceValue * meta.coupon / 2; // 1회 지급액
  const couponDates: Date[] = [];
  const d = new Date(maturityDate);
  while (d.getTime() > now.getTime()) {
    couponDates.unshift(new Date(d));
    d.setUTCMonth(d.getUTCMonth() - 6);
  }

  const remainingCoupons  = couponDates.length;
  const totalCouponFX     = couponPerUnit * remainingCoupons * netQty;
  const principalFX       = faceValue * netQty;
  const maturityValueFX   = principalFX + totalCouponFX;
  const maturityPnlFX     = maturityValueFX - purchaseAmtFX;
  const maturityPnlPct    = purchaseAmtFX > 0 ? maturityPnlFX / purchaseAmtFX * 100 : 0;
  const daysLeft          = Math.ceil((maturityDate.getTime() - now.getTime()) / (24 * 3600 * 1000));

  return {
    maturityDate    : meta.maturity,       // 만기일 YYYY-MM-DD
    faceValue,                              // 액면가 per unit
    couponPerUnit,                          // 1회 쿠폰 per unit
    remainingCoupons,                       // 남은 쿠폰 횟수
    principalFX,                            // 원금 총액(qty×face)
    totalCouponFX,                          // 잔여 쿠폰 합계
    maturityValueFX,                        // 만기 수령 합계
    maturityPnlFX,                          // 만기 손익
    maturityPnlPct,                         // 만기 수익률 %
    daysLeft,                               // 만기까지 남은 일수
  };
}

// 원장 데이터가 비어있을 때 반환하는 빈 응답 (에러가 아닌 정상 빈 결과)
const EMPTY = { success: true, cash: [], stocks: [], funds: [],
                totalKRW: 0, totalCashKRW: 0, totalStockKRW: 0, totalFundKRW: 0 };

/**
 * POST /api/portfolio
 *
 * 포트폴리오 현황을 계산해서 반환하는 메인 API 핸들러.
 *
 * 요청 바디(JSON) 옵션:
 * @param filters.owner        오너 이름 (어떤 스프레드시트를 읽을지 결정)
 * @param filters.endDate      기준일 'YYYY-MM-DD' — 해당 날짜까지의 거래만 집계
 * @param filters.accountOwner 특정 계좌 오너로 필터링
 * @param filters.account      특정 계좌명으로 필터링
 */
export async function POST(req: NextRequest) {
  const filters = await req.json().catch(() => ({})); // JSON 파싱 실패 시 빈 객체로 대체

  try {
    const spreadsheetId = getOwnerSheetId(filters.owner);

    // ── 기준일 파싱 ──
    // '2024-12-31' 형식을 Date 객체로 변환. 해당 날짜의 23:59:59까지 포함
    let endDate: Date | null = null;
    if (filters.endDate) {
      const ep = String(filters.endDate).split('-');
      if (ep.length === 3) {
        endDate = new Date(Number(ep[0]), Number(ep[1]) - 1, Number(ep[2]));
        endDate.setHours(23, 59, 59);
      }
    }

    // ── 시트 데이터 읽기 ──
    // 원장(Ledger)과 마스터(Master) 시트를 동시에 읽는다.
    // 마스터 시트: 지역별 통화 코드(region→currency) 매핑 정보를 보관
    const [ledgerData, masterData] = await Promise.all([
      getSheetValues(spreadsheetId, LEDGER_SHEET_NAME),
      getSheetValues(spreadsheetId, MASTER_SHEET_NAME).catch(() => [] as any[][]),
    ]);

    if (ledgerData.length < 2) return NextResponse.json(EMPTY);

    const headers = ledgerData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const col = (n: string) => headers.indexOf(n.toLowerCase());

    const regionIdx = col('region');    const assetIdx  = col('asset type');
    const tickerIdx = col('ticker');    const nameIdx   = col('name');
    const tradeIdx  = col('trade');     const priceIdx  = col('price');
    const currIdx   = col('currency');  const qtyIdx    = col('quantity');
    const divIdx    = col('dividend');  const taxIdx    = col('tax');
    const chgIdx    = col('charge');    const dateIdx   = col('date');
    const acctIdx   = col('account');   const aoIdx     = col('account owner');

    // ── Master → region-currency 매핑 ──
    // 마스터 시트에서 '지역(region) → 통화(currency)' 대응표를 구성한다.
    // 예: { "US": "USD", "JP": "JPY", "KR": "KRW" }
    const currencyMap: Record<string, string> = {};
    if (masterData.length > 1) {
      const mh = masterData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
      const mr = mh.indexOf('region'), mc = mh.indexOf('currency');
      masterData.slice(1).forEach((r: any[]) => {
        const reg = String(r[mr] ?? '').trim();
        const cur = String(r[mc] ?? '').trim();
        if (reg && cur) currencyMap[reg] = cur;
      });
    }

    const latestRate: Record<string, number> = {};
    const cashFX: Record<string, number>     = {};
    const posMap: Record<string, any>        = {};

    // ── 행 필터 ──
    // 기준일·계좌오너·계좌명 조건에 맞는 행만 통과시킨다.
    // false를 반환하면 해당 행은 집계에서 제외된다.
    const rowFilter = (row: any[]): boolean => {
      if (endDate && dateIdx >= 0) {
        const raw = row[dateIdx];
        let rowDate: Date;
        if (typeof raw === 'number') {
          rowDate = new Date((raw - 25569) * 86400 * 1000);
        } else {
          rowDate = new Date(String(raw ?? ''));
        }
        if (!isNaN(rowDate.getTime()) && rowDate > endDate) return false;
      }
      if (filters.accountOwner && aoIdx >= 0) {
        if (String(row[aoIdx] ?? '').trim() !== filters.accountOwner) return false;
      }
      if (filters.account && acctIdx >= 0) {
        if (String(row[acctIdx] ?? '').trim() !== filters.account) return false;
      }
      return true;
    };

    // ── 거래 집계 ──
    // 원장의 각 행을 순서대로 읽으면서 현금 잔고와 종목 포지션을 누적 계산한다.
    // 거래 유형(trade)에 따라 다음과 같이 처리:
    //   dep(입금)   : 현금 증가 (세금·수수료 차감)
    //   with(출금)  : 현금 감소 (세금·수수료 추가)
    //   buy         : 현금 감소 + 종목 매입수량·매입원가 증가
    //   sell        : 현금 증가 + 종목 매도수량 증가
    //   div(배당)   : 현금 증가 + 배당 합계 누적
    //   stockdiv    : 주식배당 — 주식 수량·원가에도 반영
    //   split       : 주식 분할 (수량 증가)
    //   merge/reversesplit: 주식 병합 (수량 감소)
    ledgerData.slice(1).forEach((row: any[]) => {
      if (!rowFilter(row)) return;

      const t      = String(row[tradeIdx]  ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      const region = String(row[regionIdx] ?? '').trim();
      const asset  = String(row[assetIdx]  ?? '').trim();
      const ticker = String(row[tickerIdx] ?? '').trim().toUpperCase();
      const price  = Number(row[priceIdx]) || 0;
      const rate   = Number(row[currIdx])  || 0;
      const qty    = Number(row[qtyIdx])   || 0;
      const divAmt = Number(row[divIdx])   || 0;
      const tax    = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
      const charge = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;

      if (rate > 0 && region) latestRate[region] = rate;
      if (!cashFX[region]) cashFX[region] = 0;

      if (t.startsWith('dep')) {
        cashFX[region] += price - tax - charge;
      } else if (t.startsWith('with')) {
        cashFX[region] -= price + tax + charge;
      } else if (t === 'buy') {
        if (asset.toLowerCase() === 'cash') {
          cashFX[region] += price * (qty || 1);
        } else {
          cashFX[region] -= price * qty + charge;
        }
      } else if (t === 'sell') {
        cashFX[region] += price * qty - tax - charge;
      } else if (t.startsWith('div') && !t.includes('stock')) {
        cashFX[region] += (divAmt || price) - tax - charge;
      } else if (t.includes('stock')) {
        cashFX[region] += divAmt - price * qty - charge - tax;
      }

      // 종목 포지션
      if (!ticker || asset.toLowerCase() === 'cash') return;
      const isDiv  = t.startsWith('div');
      const validT = ['buy','sell','split','merge','reversesplit'];
      if (!validT.includes(t) && !isDiv) return;

      if (!posMap[ticker]) {
        posMap[ticker] = {
          ticker, name: String(row[nameIdx] ?? '').trim(),
          assetType: asset, region,
          buyQty: 0, splitAdj: 0, sellQty: 0,
          buyCostFX: 0, buyCostKRW: 0,
          divFX: 0, divKRW: 0, lastRate: 0,
        };
      }
      const p = posMap[ticker];
      const effRate = rate > 0 ? rate : (latestRate[region] || 1);
      if (rate > 0) p.lastRate = rate;

      if (t === 'buy') {
        p.buyQty     += qty;
        p.buyCostFX  += price * qty;
        p.buyCostKRW += Math.floor(price * qty * effRate);  // 거래일별 환산 후 소수점 버림
      } else if (t === 'sell') {
        p.sellQty += qty;
      } else if (t === 'split') {
        p.splitAdj += qty;
      } else if (t === 'merge' || t === 'reversesplit') {
        p.splitAdj -= qty;
      } else if (isDiv) {
        if (t.includes('stock')) {
          p.buyQty     += qty;
          p.buyCostFX  += price * qty;
          p.buyCostKRW += Math.floor(price * qty * effRate);  // 거래일별 환산 후 소수점 버림
          p.divFX      += divAmt;
          p.divKRW     += Math.floor(divAmt * effRate);  // 거래일별 환산 후 소수점 버림
        } else {
          p.divFX  += (divAmt || price);
          p.divKRW += Math.floor((divAmt || price) * effRate);  // 거래일별 환산 후 소수점 버림
        }
      }
    });

    // ── 기준일 문자열 (YYYY-MM-DD) ──
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const endDateStr = endDate
      ? `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-${pad2(endDate.getDate())}`
      : undefined;

    // ── 현재가 / 역사적 종가 + 연배당 병렬 조회 ──
    // 야후 파이낸스에서 각 종목의 현재가(또는 기준일 종가)를 동시에 조회한다.
    // 기준일이 지정된 경우: 그 날짜의 종가 사용 (과거 시점 포트폴리오 재현)
    // 기준일이 없는 경우: 실시간 현재가 + 연간 배당 동시 조회
    const tickers      = Object.keys(posMap);
    const [priceResults, annDivResults] = await Promise.all([
      Promise.allSettled(tickers.map(tk => getStockPrice(tk, endDateStr).catch(() => 0))),
      // 기준일 지정 시에는 연배당 조회 불필요 (현재 포트폴리오만 의미 있음)
      endDateStr
        ? Promise.resolve(tickers.map(() => ({ status: 'fulfilled' as const, value: 0 })))
        : Promise.allSettled(tickers.map(tk => getAnnualDividendPerShare(tk).catch(() => 0))),
    ]);
    const priceMap: Record<string, number> = {};
    const annDivMap: Record<string, number> = {};
    tickers.forEach((tk, i) => {
      const r = priceResults[i];
      priceMap[tk] = r.status === 'fulfilled' ? (Number(r.value) || 0) : 0;
      const d = annDivResults[i];
      annDivMap[tk] = d.status === 'fulfilled' ? (Number(d.value) || 0) : 0;
    });

    // ── 채권 ISIN 이름 조회 (Naver 채권 API) ──
    const bondNameMap: Record<string, string> = {};
    const bondTickers = tickers.filter(isKoreanBondISIN);
    if (bondTickers.length > 0 && !endDateStr) {
      await Promise.allSettled(bondTickers.map(async tk => {
        const { name } = await getNaverBondInfo(tk).catch(() => ({ price: 0, name: '' }));
        if (name && name !== tk) bondNameMap[tk] = name;
      }));
    }

    // ── 환율 조회 (기준일 지정 시 역사적 환율, 없으면 현재 환율) ──
    // 포트폴리오 전체에 사용되는 통화 목록을 수집한 뒤 한 번에 환율을 조회한다.
    // 환율 우선순위: 야후 파이낸스 조회값 → 원장의 최근 기록값 → 1(기본값)
    const histRateMap: Record<string, number> = { KRW: 1 };
    const uniqueCurrencies = Array.from(new Set([
      ...tickers.map(k => currencyMap[posMap[k].region] || 'KRW'),
      ...Object.keys(cashFX).map(r => currencyMap[r] || 'KRW'),
    ])).filter(c => c !== 'KRW');

    if (uniqueCurrencies.length > 0) {
      const rateResults = await Promise.allSettled(
        uniqueCurrencies.map(c => getExchangeRate(c, endDateStr))
      );
      uniqueCurrencies.forEach((c, i) => {
        const r = rateResults[i];
        const rate = r.status === 'fulfilled' ? (Number(r.value) || 0) : 0;
        if (rate > 0) histRateMap[c] = rate;
      });
    }

    // 지역 → 환율 결정: 역사적(야후) → 원장 최근값 → 1 순 우선순위
    const resolveRate = (region: string, fallback = 1): number => {
      const currency = currencyMap[region] || 'KRW';
      if (currency === 'KRW') return 1;
      return histRateMap[currency] || fallback || 1;
    };

    // ── 포지션 계산 ──
    // 각 종목에 대해 손익과 평가금액을 최종 계산한다.
    // 매도를 모두 완료한 종목(netQty≈0)은 결과에서 제외한다.
    const stocks: any[] = [], funds: any[] = [];

    Object.keys(posMap).forEach(key => {
      const p            = posMap[key];
      const effectiveQty = p.buyQty + p.splitAdj; // 분할·합병 반영 실질 매입수량
      const netQty       = effectiveQty - p.sellQty; // 현재 보유수량
      if (netQty < 0.0001) return; // 전량 매도된 종목은 건너뜀

      const avgPriceFX  = effectiveQty > 0 ? p.buyCostFX / effectiveQty : 0; // 평균 매입단가 (현지통화)
      const currency    = currencyMap[p.region] || 'KRW';
      const isKRW       = currency === 'KRW';
      // 현재 평가에 적용할 환율: 야후 조회값 → 원장 최근값 → 1 순서로 사용
      const effRate2    = isKRW ? 1 : resolveRate(p.region, p.lastRate > 0 ? p.lastRate : (latestRate[p.region] || 1));

      // 취득원가(원화): 거래일별 floor 누적된 buyCostKRW를 netQty/effectiveQty 비율로 환산
      // (매도가 있는 경우 평균 매입원가 기준 비례 축소)
      const purchaseAmtKRW = isKRW
        ? Math.floor(avgPriceFX * netQty)
        : (effectiveQty > 0 ? Math.floor(p.buyCostKRW * netQty / effectiveQty) : 0);
      // 현재가 조회 불가(0)인 경우: Bond ISIN이면 매입단가로 대체 (평가손실 0%)
      const rawPriceFX  = priceMap[p.ticker] || 0;
      const curPriceFX  = rawPriceFX > 0 ? rawPriceFX
                        : isKoreanBondISIN(p.ticker) ? avgPriceFX : 0;
      // 현재 평가액(원화): 현재가 × 보유수량 × 현재 환율 (단일 환산 → floor)
      const marketValueKRW = isKRW
        ? Math.floor(curPriceFX * netQty)
        : Math.floor(curPriceFX * netQty * effRate2);
      // 평가손익(원화) = 현재 평가액 - 취득원가
      const pnl            = marketValueKRW - purchaseAmtKRW;

      const purchaseAmtFX = avgPriceFX * netQty;
      const marketValueFX = curPriceFX  * netQty;
      const pnlFX         = marketValueFX - purchaseAmtFX;

      // 수익률: 현지통화 기준 (KRW 종목은 KRW, 외화 종목은 해당 통화 기준)
      const pnlPct = isKRW
        ? (purchaseAmtKRW > 0 ? pnl / purchaseAmtKRW * 100 : 0)
        : (purchaseAmtFX  > 0 ? pnlFX / purchaseAmtFX  * 100 : 0);

      // 채권 ISIN인 경우 Naver에서 가져온 이름 우선 사용
      const displayName = bondNameMap[p.ticker] || p.name || p.ticker;

      const purAmtFXForBond = isKRW ? purchaseAmtKRW : purchaseAmtFX;
      const item = {
        ticker: p.ticker, name: displayName, currency, region: p.region,
        quantity: netQty, avgPrice: avgPriceFX,
        purchaseAmt  : purchaseAmtKRW, currentPrice: curPriceFX,
        marketValue  : marketValueKRW, pnl, pnlPct,
        purchaseAmtFX: isKRW ? purchaseAmtKRW : purchaseAmtFX,
        marketValueFX: isKRW ? marketValueKRW : marketValueFX,
        pnlFX        : isKRW ? pnl            : pnlFX,
        divFX: p.divFX, divKRW: p.divKRW,
        // 예상 연배당 (주당 연배당 × 보유수량)
        annualDivFX : (annDivMap[p.ticker] || 0) * netQty,
        annualDivKRW: (annDivMap[p.ticker] || 0) * netQty * (isKRW ? 1 : resolveRate(p.region, p.lastRate || 1)),
        // 만기보유 평가 (BOND_META 등록 채권만, null이면 해당 없음)
        maturityEval : isKoreanBondISIN(p.ticker)
          ? calcMaturityEval(p.ticker, netQty, purAmtFXForBond)
          : null,
      };

      // 자산 유형에 따라 stocks 배열(주식·ETF) 또는 funds 배열(펀드·채권)에 분류
      const at = p.assetType.toLowerCase();
      if (at === 'stock' || at === 'etf')    stocks.push(item);   // Stock(ETF) 섹션
      else if (at === 'fund' || at === 'bond') funds.push(item);  // Fund/Bond 섹션
    });

    // 종목 코드(ticker) 알파벳순으로 정렬
    stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
    funds.sort((a, b)  => a.ticker.localeCompare(b.ticker));

    // ── 현금 요약 ──
    // 지역별 현금 잔고를 원화로 환산한 목록을 만든다.
    // 잔고가 0에 가까운 지역(±0.001 미만)은 표시에서 제외
    const cash = Object.keys(cashFX)
      .map(region => {
        const amount   = cashFX[region];
        const currency = currencyMap[region] || 'KRW';
        const isKRW    = currency === 'KRW';
        const rate     = isKRW ? 1 : resolveRate(region, latestRate[region] || 1);
        return { region, currency, amount, rate,
                 amountKRW: isKRW ? amount : amount * rate };
      })
      .filter(c => Math.abs(c.amount) > 0.001);

    // 현금·주식·펀드/채권 각 섹션의 원화 합산
    const totalCashKRW  = cash.reduce((s, c)  => s + c.amountKRW,   0);
    const totalStockKRW = stocks.reduce((s, i) => s + i.marketValue, 0);
    const totalFundKRW  = funds.reduce((s, i)  => s + i.marketValue, 0);

    return NextResponse.json({
      success: true, cash, stocks, funds,
      totalKRW     : totalCashKRW + totalStockKRW + totalFundKRW,
      totalCashKRW, totalStockKRW, totalFundKRW,
    });

  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
