import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/config';
import { getExchangeRate, getStockPrice } from '@/lib/stock';

// ── 한국 종목 Yahoo 티커 변환 (476550 → 476550.KS) ─────────────────────
function toYahooTicker(ticker: string, currency: string): string {
  if (currency === 'KRW' && !ticker.includes('.')) return `${ticker}.KS`;
  return ticker;
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
        result.indicators?.adjclose?.[0]?.adjclose ||
        result.indicators?.quote?.[0]?.close || [];

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

    // 날짜순 정렬
    const sorted = rows
      .map((row: any[]) => ({ row, date: parseDate(row[dateIdx]) }))
      .filter(({ date }) => date !== null)
      .sort((a, b) => a.date!.getTime() - b.date!.getTime());

    if (sorted.length === 0) {
      return NextResponse.json({ success: true, summary: null, monthly: [], indices: {}, stocks: [] });
    }

    // ── 분석 대상 월 목록 (최근 13개월) ─────────────────────────────
    const firstDate = sorted[0].date!;
    const now       = new Date();
    const nowMM     = toYYYYMM(now);

    const allMonths: string[] = [];
    let cur = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1));
    while (toYYYYMM(cur) <= nowMM) {
      allMonths.push(toYYYYMM(cur));
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
    const analyzeMonths = allMonths.slice(-13); // 최대 13개월

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
    for (const mm of analyzeMonths) {
      const endDt = monthEndDate(mm);
      // 이 월말까지의 모든 거래 처리
      while (txIdx < sorted.length && sorted[txIdx].date! <= endDt) {
        const { row } = sorted[txIdx++];

        const t       = String(row[tradeIdx]  ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
        const region  = String(row[regionIdx] ?? '').trim();
        const asset   = String(row[assetIdx]  ?? '').trim();
        const ticker  = String(row[tickerIdx] ?? '').trim().toUpperCase();
        const price   = Number(row[priceIdx]) || 0;
        const rate    = Number(row[currIdx])  || 0;
        const qty     = Number(row[qtyIdx])   || 0;
        const divAmt  = Number(row[divIdx])   || 0;
        const tax     = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
        const charge  = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;

        if (!runningState.cashFX[region]) runningState.cashFX[region] = 0;
        const effRate = rate > 0 ? rate : (runningState.latestRate[region] || 1);
        if (rate > 0) runningState.latestRate[region] = rate;

        if (t.startsWith('dep')) {
          runningState.cashFX[region]    += price - tax - charge;
          runningState.netDepositKRW     += (price - tax - charge) * effRate;
        } else if (t.startsWith('with')) {
          runningState.cashFX[region]    -= price + tax + charge;
          runningState.netDepositKRW     -= (price + tax + charge) * effRate;
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

    // ── 병렬 데이터 조회 ─────────────────────────────────────────
    const [tickerHistory, currentPriceList, indexHistory, exchangeRates] = await Promise.all([
      // 종목 월별 역사적 종가 (Yahoo Finance — 한국 종목은 .KS 접미사)
      Promise.all(heldTickers.map(async t => {
        const currency = currencyMap[currentState.positions[t].region] || 'KRW';
        const yahooTk  = toYahooTicker(t, currency);
        return {
          ticker: t,
          data: await fetchMonthlyCloses(yahooTk, 15).catch(() => [] as { month: string; close: number }[]),
        };
      })),
      // 종목 현재가 (getStockPrice — portfolio 탭과 동일 방식)
      Promise.allSettled(heldTickers.map(t => getStockPrice(t))),
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
      currentPrice[t] = fromApi > 0 ? fromApi : fromHistory;
    });

    // ── 요약 ──────────────────────────────────────────────────────
    const resolveRate = (region: string) => {
      const cur = currencyMap[region] || 'KRW';
      return cur === 'KRW' ? 1 : (exchangeRates[region] || currentState.latestRate[region] || 1);
    };

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
    const summary = {
      netInvestmentKRW: Math.round(netInvKRW),
      marketValueKRW:   Math.round(marketValueKRW),
      pnlKRW:           Math.round(marketValueKRW - netInvKRW),
      pnlPct:           netInvKRW > 0 ? (marketValueKRW - netInvKRW) / netInvKRW * 100 : 0,
    };

    // ── 종목별 연간/월간 수익률 ──────────────────────────────────
    const prevYearDec = `${now.getFullYear() - 1}-12`;
    const prevMonth   = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

    const stocks = heldTickers.map(t => {
      const p = currentState.positions[t];
      if (p.qty < 0.0001) return null;
      const pm = priceMap[t] || {};
      const cp = currentPrice[t] || 0;
      const rate = resolveRate(p.region);
      const mktVal = cp * p.qty * rate;
      const ysp  = pm[prevYearDec]  || pm[`${now.getFullYear()}-01`] || 0;
      const mpsp = pm[prevMonth] || 0;
      return {
        ticker: t, name: p.name,
        currency: currencyMap[p.region] || 'KRW',
        marketValueKRW: Math.round(mktVal),
        currentPrice: cp,
        annualReturnPct:  ysp  > 0 && cp > 0 ? (cp - ysp)  / ysp  * 100 : null,
        monthlyReturnPct: mpsp > 0 && cp > 0 ? (cp - mpsp) / mpsp * 100 : null,
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
        const price = priceMap[t]?.[mm] || 0;
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

    return NextResponse.json({ success: true, summary, monthly, indices, stocks });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
