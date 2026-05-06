import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/config';
import { getExchangeRate, getStockPrice, getStockInfo, isKoreanCode, getMonthlyDivPerShare } from '@/lib/stock';

// ── 한국 채권 ISIN 판별 (KR + 10자리) ────────────────────────────────────
function isKoreanBondISIN(ticker: string): boolean {
  return /^KR[A-Z0-9]{10}$/i.test(ticker.trim());
}

// ── 한국 종목 Yahoo 티커 변환 (476550 → 476550.KS) ─────────────────────
// 채권 ISIN(KR...)은 Yahoo로 조회하지 않으므로 변환 제외
function toYahooTicker(ticker: string, currency: string): string {
  if (isKoreanBondISIN(ticker)) return ticker; // ISIN은 변환 불필요
  if (currency === 'KRW' && !ticker.includes('.')) return `${ticker}.KS`;
  return ticker;
}

// ── YTD/MTD 기준가 조회 (1d interval) — stock-info 팝업과 동일한 기준 ──────
// YTD: 당해년 1월 1일 이후 첫 거래일 종가
// MTD: 이번 달 1일 이후 첫 거래일 종가
async function fetchPeriodStartPrices(
  ticker: string
): Promise<{ ytd: number; mtd: number }> {
  const now  = new Date();
  const ytdStartTs = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
  const mtdStartTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const fetchStart = Math.floor(ytdStartTs) - 5 * 86400; // 5일 여유
  const fetchEnd   = Math.floor(Date.now() / 1000) + 86400;
  const encoded    = encodeURIComponent(ticker);

  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&period1=${fetchStart}&period2=${fetchEnd}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
      });
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;
      const timestamps: number[] = result.timestamp || [];
      const closes: number[]     = result.indicators?.quote?.[0]?.close || [];

      let ytd = 0, mtd = 0;
      for (let i = 0; i < timestamps.length; i++) {
        const c = Number(closes[i]);
        if (!c) continue;
        if (!ytd && timestamps[i] >= ytdStartTs) ytd = c;
        if (!mtd && timestamps[i] >= mtdStartTs) mtd = c;
      }
      return { ytd, mtd };
    } catch (_e) { /* try next host */ }
  }
  return { ytd: 0, mtd: 0 };
}

// ── 월별 종가 조회 (Yahoo Finance 1mo interval) ──────────────────────────
async function fetchMonthlyCloses(
  ticker: string, months = 15
): Promise<{ month: string; close: number }[]> {
  const end = Math.floor(Date.now() / 1000) + 86400;
  const start = end - (months + 2) * 31 * 86400;
  const encoded = encodeURIComponent(ticker);

  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1mo&period1=${start}&period2=${end}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
      });
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp || [];
      const closes: number[] =
        result.indicators?.quote?.[0]?.close ||
        result.indicators?.adjclose?.[0]?.adjclose || [];

      const data = timestamps
        .map((ts, i) => {
          const d = new Date(ts * 1000);
          return {
            month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            close: Number(closes[i]) || 0,
          };
        })
        .filter(x => x.close > 0);

      return data.slice(-months);
    } catch (_e) { /* try next host */ }
  }
  return [];
}

// ── 날짜 파싱 ──────────────────────────────────────────────────────────
function parseDate(raw: any): Date | null {
  if (!raw) return null;
  if (typeof raw === 'number') return new Date((raw - 25569) * 86400 * 1000);
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
}

function toYYYYMM(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthEndDate(yyyymm: string): Date {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59)); // last day of month
}

// ── 메인 라우트 ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const filters = await req.json().catch(() => ({}));

  try {
    const spreadsheetId = getOwnerSheetId(filters.owner);

    // 시트 읽기
    const [ledgerData, masterData] = await Promise.all([
      getSheetValues(spreadsheetId, LEDGER_SHEET_NAME),
      getSheetValues(spreadsheetId, MASTER_SHEET_NAME).catch(() => [] as any[][]),
    ]);

    if (ledgerData.length < 2) {
      return NextResponse.json({ success: true, summary: null, monthly: [], indices: {}, stocks: [] });
    }

    const headers = ledgerData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const col = (n: string) => headers.indexOf(n.toLowerCase());

    const dateIdx   = col('date'),          aoIdx    = col('account owner');
    const acctIdx   = col('account'),        regionIdx = col('region');
    const assetIdx  = col('asset type'),     tickerIdx = col('ticker');
    const nameIdx   = col('name'),           tradeIdx  = col('trade');
    const priceIdx  = col('price'),          currIdx   = col('currency');
    const qtyIdx    = col('quantity'),       divIdx    = col('dividend');
    const taxIdx    = col('tax'),            chgIdx    = col('charge');

    // currencyMap
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

    // 행 필터
    const rows = ledgerData.slice(1).filter((row: any[]) => {
      if (filters.accountOwner && aoIdx >= 0 && String(row[aoIdx] ?? '').trim() !== filters.accountOwner) return false;
      if (filters.account     && acctIdx >= 0 && String(row[acctIdx] ?? '').trim() !== filters.account)     return false;
      return true;
    });

    // 날짜순 정렬 — 날짜 없는 행은 epoch(0)으로 처리해 맨 앞에 놓음
    // (현황 탭과 동일하게 날짜 없는 입금도 순투자액에 포함)
    const EPOCH = new Date(0);
    const sorted = rows
      .map((row: any[]) => ({ row, date: parseDate(row[dateIdx]) ?? EPOCH }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // 분석 시작월은 epoch를 제외한 첫 실제 날짜 기준
    const firstActual = sorted.find(({ date }) => date.getTime() > 0)?.date;

    if (!firstActual) {
      return NextResponse.json({ success: true, summary: null, monthly: [], indices: {}, stocks: [] });
    }

    // ── 월별 배당 집계 (전체 기간 — 연도×월 크로스탭) ────────────────
    const divByYearMonth: Record<string, Record<string, number>> = {};
    const divRateCache: Record<string, number> = {};
    // 종목별 월배당 상세 (예상 계산용): [year][mo][ticker] = { divKRW, qty }
    const divDetailMap: Record<string, Record<string, Record<string, { divKRW: number; qty: number }>>> = {};
    const runQtyMap: Record<string, number> = {};  // 배당 시점 수량 추적

    sorted.forEach(({ row, date }) => {
      if (date.getTime() === 0) return;
      const t2      = String(row[tradeIdx]  ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      const ticker2 = String(row[tickerIdx] ?? '').trim().toUpperCase();
      const qty2    = Number(row[qtyIdx])   || 0;
      const asset2  = String(row[assetIdx]  ?? '').trim().toLowerCase();

      // 수량 추적 (배당 시점 보유량 계산용)
      if (ticker2 && asset2 !== 'cash') {
        if (!runQtyMap[ticker2]) runQtyMap[ticker2] = 0;
        if (t2 === 'buy') runQtyMap[ticker2] += qty2;
        else if (t2 === 'sell') runQtyMap[ticker2] -= qty2;
        else if (t2 === 'split') runQtyMap[ticker2] += qty2;
        else if (t2 === 'merge' || t2 === 'reversesplit') runQtyMap[ticker2] -= qty2;
        else if (t2.startsWith('div') && t2.includes('stock')) runQtyMap[ticker2] += qty2;
      }

      if (!t2.startsWith('div') && !t2.includes('stock')) return;
      const region2 = String(row[regionIdx] ?? '').trim();
      const price2  = Number(row[priceIdx]) || 0;
      const rate2   = Number(row[currIdx])  || 0;
      const div2    = Number(row[divIdx])   || 0;
      const tax2    = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
      const chg2    = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;
      if (rate2 > 0) divRateCache[region2] = rate2;
      const eff2    = rate2 > 0 ? rate2 : (divRateCache[region2] || 1);
      let divKRW = 0;
      if (t2.startsWith('div') && !t2.includes('stock')) {
        divKRW = ((div2 || price2) - tax2 - chg2) * eff2;
      } else if (t2.includes('stock') && div2 > 0) {
        divKRW = div2 * eff2;
      }
      if (divKRW <= 0) return;
      const yr = String(date.getUTCFullYear());
      const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
      if (!divByYearMonth[yr]) divByYearMonth[yr] = {};
      divByYearMonth[yr][mo] = (divByYearMonth[yr][mo] || 0) + divKRW;

      // 현금배당 & ticker 있는 경우: 종목별 상세 기록
      if (ticker2 && t2.startsWith('div') && !t2.includes('stock')) {
        const qtyAtDiv = runQtyMap[ticker2] || 0;
        if (qtyAtDiv > 0) {
          if (!divDetailMap[yr]) divDetailMap[yr] = {};
          if (!divDetailMap[yr][mo]) divDetailMap[yr][mo] = {};
          if (!divDetailMap[yr][mo][ticker2]) divDetailMap[yr][mo][ticker2] = { divKRW: 0, qty: qtyAtDiv };
          divDetailMap[yr][mo][ticker2].divKRW += divKRW;
          divDetailMap[yr][mo][ticker2].qty = qtyAtDiv;
        }
      }
    });

    const dividends = Object.entries(divByYearMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, months]) => ({
        year,
        months: Object.fromEntries(
          Object.entries(months).map(([k, v]) => [k, Math.round(v)])
        ),
        total: Math.round(Object.values(months).reduce((s, v) => s + v, 0)),
      }));

    // ── 분석 대상 월 목록 (최근 13개월) ─────────────────────────────
    const firstDate = firstActual;
    const now       = new Date();
    const nowMM     = toYYYYMM(now);

    const allMonths: string[] = [];
    let cur = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1));
    while (toYYYYMM(cur) <= nowMM) {
      allMonths.push(toYYYYMM(cur));
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }

    // 사용자 지정 월 범위 적용 (없으면 최근 13개월)
    const startMonth = filters.startMonth ? String(filters.startMonth) : '';
    const endMonth   = filters.endMonth   ? String(filters.endMonth)   : '';
    let analyzeMonths: string[];
    if (startMonth || endMonth) {
      analyzeMonths = allMonths.filter(mm =>
        (!startMonth || mm >= startMonth) &&
        (!endMonth   || mm <= endMonth)
      );
      if (analyzeMonths.length === 0) analyzeMonths = allMonths.slice(-1); // 최소 1개
    } else {
      analyzeMonths = allMonths.slice(-13); // 기본값: 최근 13개월
    }

    // 월 초(1~5일)이고 사용자 지정 endMonth 없으면 당월 제외
    // (당월은 Yahoo 월별 종가 미확정 → 평가액 왜곡 방지)
    const todayDay = now.getUTCDate();
    if (!endMonth && todayDay <= 5 && analyzeMonths[analyzeMonths.length - 1] === nowMM) {
      analyzeMonths = analyzeMonths.slice(0, -1);
    }

    // ── 월별 수익금액 차트 기준월 (analyzeMonths[0]의 직전 월) ────────
    const firstMM = analyzeMonths[0];
    const [bfy, bfm] = firstMM.split('-').map(Number);
    const baseMM = bfm === 1
      ? `${bfy - 1}-12`
      : `${bfy}-${String(bfm - 1).padStart(2, '0')}`;
    // 직전 월이 allMonths 범위 안이면 상태 계산을 위해 포함
    const computeMonths = allMonths.includes(baseMM) ? [baseMM, ...analyzeMonths] : analyzeMonths;

    // ── 월별 누적 상태 계산 (단일 패스) ──────────────────────────────
    type Pos = { qty: number; buyCostFX: number; buyCostKRW: number; region: string; assetType: string; name: string; lastRate: number };

    interface State {
      cashFX: Record<string, number>;
      netDepositKRW: number;
      positions: Record<string, Pos>;
      latestRate: Record<string, number>;
    }

    const cloneState = (s: State): State => ({
      cashFX: { ...s.cashFX },
      netDepositKRW: s.netDepositKRW,
      positions: Object.fromEntries(Object.entries(s.positions).map(([k, v]) => [k, { ...v }])),
      latestRate: { ...s.latestRate },
    });

    const runningState: State = { cashFX: {}, netDepositKRW: 0, positions: {}, latestRate: {} };
    const monthlyStates: Record<string, State> = {};

    let txIdx = 0;
    for (const mm of computeMonths) {
      const endDt = monthEndDate(mm);
      // 이 월말까지의 모든 거래 처리
      while (txIdx < sorted.length && sorted[txIdx].date! <= endDt) {
        const { row } = sorted[txIdx++];

        const t       = String(row[tradeIdx]  ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
        const region  = String(row[regionIdx] ?? '').trim();
        const asset   = String(row[assetIdx]  ?? '').trim();
        const ticker  = String(row[tickerIdx] ?? '').trim().toUpperCase();
        const name    = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '';
        const price   = Number(row[priceIdx]) || 0;
        const rate    = Number(row[currIdx])  || 0;
        const qty     = Number(row[qtyIdx])   || 0;
        const divAmt  = Number(row[divIdx])   || 0;
        const tax     = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
        const charge  = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;

        // 순투자액 반영 여부: NAME이 "투자금"인 경우만 (이자소득·자동환전·잔액보정 등 제외)
        const isRealInvestment = name === '투자금';

        if (!runningState.cashFX[region]) runningState.cashFX[region] = 0;
        const effRate = rate > 0 ? rate : (runningState.latestRate[region] || 1);
        if (rate > 0) runningState.latestRate[region] = rate;

        if (t.startsWith('dep')) {
          runningState.cashFX[region]    += price - tax - charge;
          if (isRealInvestment) runningState.netDepositKRW += (price - tax - charge) * effRate;
        } else if (t.startsWith('with')) {
          runningState.cashFX[region]    -= price + tax + charge;
          if (isRealInvestment) runningState.netDepositKRW -= (price + tax + charge) * effRate;
        } else if (t === 'buy') {
          if (asset.toLowerCase() === 'cash') {
            runningState.cashFX[region] += price * (qty || 1);
          } else {
            runningState.cashFX[region] -= price * qty + charge;
          }
        } else if (t === 'sell') {
          runningState.cashFX[region] += price * qty - tax - charge;
        } else if (t.startsWith('div') && !t.includes('stock')) {
          runningState.cashFX[region] += (divAmt || price) - tax - charge;
        } else if (t.includes('stock')) {
          // Dividend-Stock: 현금 배당(divAmt) + 주식 취득 비용(-price*qty) 순효과
          // portfolio/route.ts 와 동일 로직 (divAmt=0 이면 cash 차감)
          runningState.cashFX[region] += (divAmt || 0) - price * qty - charge - tax;
        }

        if (!ticker || asset.toLowerCase() === 'cash') continue;
        const isDiv = t.startsWith('div');
        const validT = ['buy', 'sell', 'split', 'merge', 'reversesplit'];
        if (!validT.includes(t) && !isDiv) continue;

        if (!runningState.positions[ticker]) {
          runningState.positions[ticker] = {
            qty: 0, buyCostFX: 0, buyCostKRW: 0,
            region, assetType: asset,
            name: String(row[nameIdx] ?? '').trim(),
            lastRate: 0,
          };
        }
        const p = runningState.positions[ticker];
        if (rate > 0) p.lastRate = rate;

        if (t === 'buy' || (isDiv && t.includes('stock'))) {
          p.qty += qty; p.buyCostFX += price * qty; p.buyCostKRW += price * qty * effRate;
        } else if (t === 'sell') {
          p.qty -= qty;
        } else if (t === 'split') {
          p.qty += qty;
        } else if (t === 'merge' || t === 'reversesplit') {
          p.qty -= qty;
        }
      }
      monthlyStates[mm] = cloneState(runningState);
    }

    // ── 현재 보유 종목 목록 ────────────────────────────────────────
    const currentState = monthlyStates[analyzeMonths[analyzeMonths.length - 1]] || runningState;
    const heldTickers  = Object.entries(currentState.positions)
      .filter(([_, p]) => p.qty > 0.0001)
      .map(([t]) => t);

    // ── 역사적 종가 조회 대상 확장 (YTD/MTD 기준선 정확도 개선) ──────
    // YTD 기준(전년 12월) 등 과거 월 state에 보유했다가 현재는 매도된 종목도
    // 역사적 종가가 필요. heldTickers에서 누락되면 해당 월 평가액이 0으로
    // 처리되어 기준선이 낮아지고 YTD가 과대 계산됨.
    const allStateTickers = new Set<string>(heldTickers);
    Object.values(monthlyStates).forEach(st => {
      Object.entries(st.positions).forEach(([t, p]) => {
        if (p.qty > 0.0001) allStateTickers.add(t);
      });
    });
    const allHistoryTickers = Array.from(allStateTickers);

    // ── 현재 보유 종목 월별 주당배당 조회 시작 (병렬 실행, resolveRate 정의 후 await) ─
    const monthlyDivPromise = Promise.allSettled(
      heldTickers.map(tk => getMonthlyDivPerShare(tk).catch(() => ({} as Record<string, number>)))
    );

    // ── YTD/MTD 기준가 조회 시작 (병렬 실행) — stock-info 팝업과 동일 기준 ──
    const periodStartPromise = Promise.allSettled(
      heldTickers.map(tk => {
        if (isKoreanBondISIN(tk)) return Promise.resolve({ ytd: 0, mtd: 0 });
        const region   = currentState.positions[tk]?.region || '';
        const currency = currencyMap[region] || 'KRW';
        return fetchPeriodStartPrices(toYahooTicker(tk, currency)).catch(() => ({ ytd: 0, mtd: 0 }));
      })
    );

    // ── 병렬 데이터 조회 ─────────────────────────────────────────
    const [tickerHistory, currentPriceList, yesterdayPriceList, indexHistory, exchangeRates] = await Promise.all([
      // 종목 월별 역사적 종가: allHistoryTickers (현재 보유 + 과거 보유 매도 종목 포함)
      Promise.all(allHistoryTickers.map(async t => {
        if (isKoreanBondISIN(t)) {
          // 채권은 Yahoo 역사적 종가 미지원 → 빈 배열
          return { ticker: t, data: [] as { month: string; close: number }[] };
        }
        // 매도된 종목도 positions에 남아 있으므로 region 조회 가능
        const region   = currentState.positions[t]?.region || '';
        const currency = currencyMap[region] || 'KRW';
        const yahooTk  = toYahooTicker(t, currency);
        return {
          ticker: t,
          data: await fetchMonthlyCloses(yahooTk, 15).catch(() => [] as { month: string; close: number }[]),
        };
      })),
      // 종목 현재가 (getStockPrice — portfolio 탭과 동일 방식)
      Promise.allSettled(heldTickers.map(t => getStockPrice(t))),
      // 종목 전일 종가 (Daily PnL용) — 오늘 거래일 여부 판별을 위해 'all' 조회
      Promise.allSettled(heldTickers.map(t => getStockInfo(t, 'all'))),
      // 지수 월별 종가
      Promise.all([
        fetchMonthlyCloses('^KS11', 15).then(d => ({ name: 'KOSPI',  data: d })).catch(() => ({ name: 'KOSPI',  data: [] })),
        fetchMonthlyCloses('^GSPC', 15).then(d => ({ name: 'SP500',  data: d })).catch(() => ({ name: 'SP500',  data: [] })),
        fetchMonthlyCloses('^IXIC', 15).then(d => ({ name: 'NASDAQ', data: d })).catch(() => ({ name: 'NASDAQ', data: [] })),
      ]),
      // 환율 (현재)
      (async () => {
        const regions = Array.from(new Set(heldTickers.map(t => currentState.positions[t].region)));
        const rates: Record<string, number> = { KRW: 1 };
        await Promise.allSettled(regions.map(async region => {
          const currency = currencyMap[region] || 'KRW';
          if (currency === 'KRW') { rates[region] = 1; return; }
          const r = await getExchangeRate(currency).catch(() => 0);
          rates[region] = r > 0 ? r : (currentState.latestRate[region] || 1);
        }));
        return rates;
      })(),
    ]);

    // ticker → month → price 맵 (역사적 종가)
    const priceMap: Record<string, Record<string, number>> = {};
    tickerHistory.forEach(({ ticker, data }) => {
      priceMap[ticker] = Object.fromEntries(data.map(d => [d.month, d.close]));
    });

    // 현재가: getStockPrice 우선, 없으면 Yahoo 마지막 월 종가로 폴백
    const currentPrice: Record<string, number> = {};
    heldTickers.forEach((t, i) => {
      const r = currentPriceList[i];
      const fromApi = r.status === 'fulfilled' ? (Number(r.value) || 0) : 0;
      const fromHistory = (() => {
        const d = tickerHistory.find(h => h.ticker === t)?.data || [];
        return d.length > 0 ? d[d.length - 1].close : 0;
      })();
      const raw = fromApi > 0 ? fromApi : fromHistory;
      // 가격 조회 불가(0)인 경우: Bond ISIN이면 매입 평균단가로 대체
      if (raw > 0) {
        currentPrice[t] = raw;
      } else if (isKoreanBondISIN(t)) {
        const p = currentState.positions[t];
        currentPrice[t] = p.qty > 0 ? p.buyCostFX / p.qty : 0;
      } else {
        currentPrice[t] = 0;
      }
    });

    // 전일 종가 맵 (Daily PnL 계산용)
    // 오늘 날짜 KST 기준 (UTC+9)
    const todayKST = (() => {
      const d = new Date(Date.now() + 9 * 3600 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    })();

    const yesterdayPrice: Record<string, number> = {};
    heldTickers.forEach((t, i) => {
      const r = yesterdayPriceList[i];
      if (r.status !== 'fulfilled' || !r.value) {
        yesterdayPrice[t] = currentPrice[t] || 0;
        return;
      }
      const data = r.value as Record<string, any>;
      const lastTradeDate = String(data.baseDate || '').slice(0, 10);

      // 한국 주식(채권 제외): 오늘 KST에 거래가 없으면 Daily = 0 (휴장/주말)
      // → Naver localTradedAt 기준이므로 KST 날짜와 직접 비교 가능
      const isTicker = t.split('.')[0];
      if (!isKoreanBondISIN(isTicker) && isKoreanCode(isTicker)) {
        if (lastTradeDate !== todayKST) {
          yesterdayPrice[t] = currentPrice[t] || 0;
          return;
        }
      }

      // 해외 주식 / 채권: 주가는 현재가 고정 (Daily = FX 변동만), yesterdayPrice는 사용 안 함
      yesterdayPrice[t] = currentPrice[t] || 0;
    });

    // ── 요약 ──────────────────────────────────────────────────────
    const resolveRate = (region: string) => {
      const cur = currencyMap[region] || 'KRW';
      return cur === 'KRW' ? 1 : (exchangeRates[region] || currentState.latestRate[region] || 1);
    };

    // ── 월별 주당배당 KRW 환산 (resolveRate 확보 후 처리) ────────────
    const monthlyDivResults = await monthlyDivPromise;
    const tickerMonthlyDivKRW: Record<string, Record<string, number>> = {};
    heldTickers.forEach((tk, i) => {
      const r = monthlyDivResults[i];
      if (r.status !== 'fulfilled') return;
      const monthly = r.value;
      if (!monthly || Object.keys(monthly).length === 0) return;
      const p = currentState.positions[tk];
      if (!p) return;
      const rate = resolveRate(p.region);
      tickerMonthlyDivKRW[tk] = {};
      Object.entries(monthly).forEach(([mo, amt]) => {
        tickerMonthlyDivKRW[tk][mo] = (amt as number) * rate;
      });
    });

    let marketValueKRW = 0;
    Object.entries(currentState.cashFX).forEach(([region, amt]) => {
      marketValueKRW += amt * resolveRate(region);
    });
    heldTickers.forEach(t => {
      const p = currentState.positions[t];
      if (p.qty < 0.0001) return;
      marketValueKRW += (currentPrice[t] || 0) * p.qty * resolveRate(p.region);
    });

    const netInvKRW = currentState.netDepositKRW;

    // ── 어제 환율 조회 (Daily FX 변동분 계산용) ────────────────────
    // 해외 주식 및 외화 예수금: 주가 변동은 0으로 처리하고 환율 변동만 Daily에 반영
    const yesterdayDateUTC = (() => {
      const d = new Date(Date.now() - 86400 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    })();

    const allFXRegions = Array.from(new Set([
      ...Object.keys(currentState.cashFX),
      ...heldTickers.map(t => currentState.positions[t].region),
    ]));

    const yesterdayFXRates: Record<string, number> = { KRW: 1 };
    await Promise.allSettled(allFXRegions.map(async region => {
      const currency = currencyMap[region] || 'KRW';
      if (currency === 'KRW') { yesterdayFXRates[region] = 1; return; }
      const r = await getExchangeRate(currency, yesterdayDateUTC).catch(() => 0);
      yesterdayFXRates[region] = r > 0 ? r : resolveRate(region); // 조회 실패 시 현재 환율로 폴백 (FX Daily = 0)
    }));

    const resolveYesterdayRate = (region: string) =>
      yesterdayFXRates[region] ?? resolveRate(region);

    // 전일 평가액 계산:
    // - 외화 예수금: 어제 환율 적용 (FX 변동 반영)
    // - 한국 주식: 전일가 × 현재 환율 (오늘 미거래 시 yesterdayPrice = currentPrice → Daily = 0)
    // - 해외 주식/채권: 현재가 × 어제 환율 (주가 변동 없음, FX 변동만 반영)
    let yesterdayValueKRW = 0;
    Object.entries(currentState.cashFX).forEach(([region, amt]) => {
      yesterdayValueKRW += amt * resolveYesterdayRate(region);
    });
    heldTickers.forEach(t => {
      const p = currentState.positions[t];
      if (p.qty < 0.0001) return;
      const isTk = t.split('.')[0];
      const isKRStock = !isKoreanBondISIN(isTk) && isKoreanCode(isTk);
      const cp = currentPrice[t] || 0;
      if (isKRStock) {
        // 한국 주식: 전일가 × 현재 환율 (= ×1)
        yesterdayValueKRW += (yesterdayPrice[t] || cp) * p.qty * resolveRate(p.region);
      } else {
        // 해외 주식/채권: 현재가 × 어제 환율 → FX 변동만 Daily에 기여
        yesterdayValueKRW += cp * p.qty * resolveYesterdayRate(p.region);
      }
    });

    const summary = {
      netInvestmentKRW: Math.round(netInvKRW),
      marketValueKRW:   Math.round(marketValueKRW),
      pnlKRW:           Math.round(marketValueKRW - netInvKRW),
      pnlPct:           netInvKRW > 0 ? (marketValueKRW - netInvKRW) / netInvKRW * 100 : 0,
    };

    // ── 종목별 연간/월간 수익률 ──────────────────────────────────
    // YTD/MTD 기준가: 일봉 기준 (stock-info 팝업과 동일), 실패 시 월봉 폴백
    const periodStartResults = await periodStartPromise;
    const prevYearDec = `${now.getFullYear() - 1}-12`;
    const prevMonth   = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

    const stocks = heldTickers.map((t, idx) => {
      const p = currentState.positions[t];
      if (p.qty < 0.0001) return null;
      const pm = priceMap[t] || {};
      const cp = currentPrice[t] || 0;
      const rate = resolveRate(p.region);
      const mktVal = cp * p.qty * rate;
      // 일봉 기준가 우선, 없으면 월봉 폴백
      const ps = periodStartResults[idx]?.status === 'fulfilled' ? periodStartResults[idx].value : { ytd: 0, mtd: 0 };
      const ysp  = ps.ytd  || pm[prevYearDec] || pm[`${now.getFullYear()}-01`] || 0;
      const mpsp = ps.mtd  || pm[prevMonth]   || 0;

      // 현지 통화 기준 값
      const marketValueFX = cp * p.qty;   // 평가금액 (현지통화)
      const buyCostFX     = p.buyCostFX;  // 매입금액 (현지통화)

      // 인앱 현황(조회 > 현황)과 동일: KRW 기준 수익률 (가격 변동 + 환율 효과 포함)
      // mktVal = cp × qty × currentRate(KRW), p.buyCostKRW = 매수 시점 환율 기준 누적 매입금액(KRW)
      const pnlPct = p.buyCostKRW > 0 ? (mktVal - p.buyCostKRW) / p.buyCostKRW * 100 : null;

      return {
        ticker: t, name: p.name,
        currency: currencyMap[p.region] || 'KRW',
        qty: p.qty,
        marketValueKRW: Math.round(mktVal),
        marketValueFX:  marketValueFX,
        currentPrice:   cp,
        buyCostFX:      buyCostFX,
        pnlPct:         pnlPct,
        annualReturnPct:  ysp  > 0 && cp > 0 ? (cp - ysp)  / ysp  * 100 : null,
        monthlyReturnPct: mpsp > 0 && cp > 0 ? (cp - mpsp) / mpsp * 100 : null,
        yearStartPrice:   ysp  > 0 ? ysp  : null,
        monthStartPrice:  mpsp > 0 ? mpsp : null,
      };
    }).filter(Boolean).sort((a, b) => (b?.marketValueKRW || 0) - (a?.marketValueKRW || 0));

    // ── 월별 포트폴리오 가치 계산 ────────────────────────────────
    // 각 월말 state × 해당 월 역사적 가격 (환율은 현재 환율 근사)
    const monthly = analyzeMonths.map(mm => {
      const state = monthlyStates[mm];
      if (!state) return { month: mm, marketValueKRW: 0, netInvestmentKRW: 0, returnPct: 0 };

      let val = 0;
      Object.entries(state.cashFX).forEach(([region, amt]) => {
        val += amt * resolveRate(region);
      });
      Object.entries(state.positions).forEach(([t, p]) => {
        if (p.qty < 0.0001) return;
        let price = priceMap[t]?.[mm] || 0;
        // 채권 ISIN: 역사적 가격 미지원 → 매입 평균단가로 대체 (평가손익 0% 표시)
        if (price === 0 && isKoreanBondISIN(t)) {
          price = p.qty > 0 ? p.buyCostFX / p.qty : 0;
        }
        // 당월(mm===nowMM) 또는 월 초(1~5일)에 직전월 Yahoo 미확정 → currentPrice 폴백
        const isLastMonth = mm === analyzeMonths[analyzeMonths.length - 1];
        if (price === 0 && (mm === nowMM || (todayDay <= 5 && isLastMonth))) {
          price = currentPrice[t] || 0;
        }
        if (price > 0) val += price * p.qty * resolveRate(p.region);
      });

      const netInv = state.netDepositKRW;
      return {
        month: mm,
        marketValueKRW:   Math.round(val),
        netInvestmentKRW: Math.round(netInv),
        returnPct: netInv > 0 ? (val - netInv) / netInv * 100 : 0,
      };
    });

    // ── 지수 수익률 (첫 월 기준 누적 %) ────────────────────────
    const indices: Record<string, { month: string; returnPct: number }[]> = {};
    indexHistory.forEach(({ name, data }) => {
      const filtered = data.filter(d => analyzeMonths.includes(d.month));
      if (filtered.length === 0) { indices[name] = []; return; }
      const base = filtered[0].close;
      indices[name] = filtered.map(d => ({
        month:     d.month,
        returnPct: base > 0 ? (d.close - base) / base * 100 : 0,
      }));
    });

    // ── YTD / MTD 포트폴리오 손익 ──────────────────────────────────────
    // YTD = 현재 평가손익 - 기준월 평가손익
    //     = (현재 평가액 - 현재 순투자액) - (기준월 평가액 - 기준월 순투자액)
    // → 기간 중 입출금이 있어도 순수 운용 성과만 측정
    const prevYearDecEntry = monthly.find(m => m.month === prevYearDec);
    const prevMonthEntry   = monthly.find(m => m.month === prevMonth);
    const curVal    = summary.marketValueKRW;
    const curPnlKRW = curVal - netInvKRW; // 현재 평가손익

    const ytd = prevYearDecEntry && prevYearDecEntry.marketValueKRW > 0 ? (() => {
      const startPnlKRW = prevYearDecEntry.marketValueKRW - prevYearDecEntry.netInvestmentKRW;
      const pnlKRW      = curPnlKRW - startPnlKRW;
      return {
        startValueKRW : prevYearDecEntry.marketValueKRW,
        startNetInvKRW: prevYearDecEntry.netInvestmentKRW,
        startPnlKRW   : Math.round(startPnlKRW),
        pnlKRW        : Math.round(pnlKRW),
        pnlPct        : prevYearDecEntry.marketValueKRW > 0
                          ? pnlKRW / prevYearDecEntry.marketValueKRW * 100 : 0,
      };
    })() : null;

    const mtd = prevMonthEntry && prevMonthEntry.marketValueKRW > 0 ? (() => {
      const startPnlKRW = prevMonthEntry.marketValueKRW - prevMonthEntry.netInvestmentKRW;
      const pnlKRW      = curPnlKRW - startPnlKRW;
      return {
        startValueKRW : prevMonthEntry.marketValueKRW,
        startNetInvKRW: prevMonthEntry.netInvestmentKRW,
        startPnlKRW   : Math.round(startPnlKRW),
        pnlKRW        : Math.round(pnlKRW),
        pnlPct        : prevMonthEntry.marketValueKRW > 0
                          ? pnlKRW / prevMonthEntry.marketValueKRW * 100 : 0,
      };
    })() : null;

    const daily = yesterdayValueKRW > 0 ? {
      startValueKRW: Math.round(yesterdayValueKRW),
      pnlKRW       : Math.round(curVal - yesterdayValueKRW),
      pnlPct       : (curVal - yesterdayValueKRW) / yesterdayValueKRW * 100,
    } : null;

    // ── 월별 수익금액 차트용 기준월 누적손익 ─────────────────────────
    let basePnl = 0;
    const baseState = monthlyStates[baseMM];
    if (baseState && allMonths.includes(baseMM)) {
      let baseVal = 0;
      Object.entries(baseState.cashFX).forEach(([region, amt]) => {
        baseVal += amt * resolveRate(region);
      });
      Object.entries(baseState.positions).forEach(([t, p]) => {
        if (p.qty < 0.0001) return;
        const price = (priceMap[t]?.[baseMM]) || currentPrice[t] || 0;
        if (price > 0) baseVal += price * p.qty * resolveRate(p.region);
      });
      basePnl = Math.round(baseVal - baseState.netDepositKRW);
    }

    const divDetail = Object.fromEntries(
      Object.entries(divDetailMap).map(([yr, months]) => [
        yr,
        Object.fromEntries(
          Object.entries(months).map(([mo, tickers]) => [
            mo,
            Object.fromEntries(
              Object.entries(tickers).map(([tk, v]) => [
                tk,
                { divKRW: Math.round(v.divKRW), qty: v.qty },
              ])
            ),
          ])
        ),
      ])
    );
    return NextResponse.json({ success: true, summary: { ...summary, ytd, mtd, daily }, monthly, indices, stocks, dividends, divDetail, tickerMonthlyDivKRW, basePnl });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
