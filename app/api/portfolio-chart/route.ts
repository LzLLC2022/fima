import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, LEDGER_SHEET_NAME } from '@/lib/config';

// ── 한국 채권 ISIN 판별 (KR + 10자리) ────────────────────────────────────
function isKoreanBondISIN(ticker: string): boolean {
  return /^KR[A-Z0-9]{10}$/i.test(ticker.trim());
}

// ── 한국 종목 Yahoo 티커 변환 ──────────────────────────────────────────
function toYahooTicker(ticker: string, currency: string): string {
  if (isKoreanBondISIN(ticker)) return ticker;
  if (currency === 'KRW' && !ticker.includes('.')) return `${ticker}.KS`;
  return ticker;
}

// ── 주기별 종가 조회 (Yahoo Finance) ────────────────────────────────────
async function fetchPeriodicCloses(
  ticker: string, interval: '1mo'|'1wk'|'1d', months = 15
): Promise<{ period: string; close: number }[]> {
  const end = Math.floor(Date.now() / 1000) + 86400;
  const start = end - (months + 2) * 31 * 86400;
  const encoded = encodeURIComponent(ticker);

  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&period1=${start}&period2=${end}`;
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
          let period = '';
          if (interval === '1mo') {
            period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          } else {
            period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          }
          return {
            period,
            close: Number(closes[i]) || 0,
          };
        })
        .filter(x => x.close > 0);

      // Return a reasonable number of points depending on interval
      if (interval === '1mo') return data.slice(-months);
      if (interval === '1wk') return data.slice(-(months * 5));
      if (interval === '1d') return data.slice(-(months * 22)); // approx trading days
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
function toYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── 메인 라우트 ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const filters = await req.json().catch(() => ({}));
  
  try {
    const spreadsheetId = getOwnerSheetId(filters.owner);
    const [ledgerData] = await Promise.all([
      getSheetValues(spreadsheetId, LEDGER_SHEET_NAME),
    ]);

    if (ledgerData.length < 2) {
      return NextResponse.json({ success: true, periodic: [], indices: {} });
    }

    const headers = ledgerData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const col = (n: string) => headers.indexOf(n.toLowerCase());

    const dateIdx   = col('date'),          aoIdx    = col('account owner');
    const acctIdx   = col('account'),        regionIdx = col('region');
    const assetIdx  = col('asset type'),     tickerIdx = col('ticker');
    const nameIdx   = col('name'),           tradeIdx  = col('trade');
    const priceIdx  = col('price'),          currIdx   = col('currency');
    const qtyIdx    = col('quantity'),       taxIdx    = col('tax'), chgIdx = col('charge');

    const rows = ledgerData.slice(1).filter((row: any[]) => {
      if (filters.accountOwner && aoIdx >= 0) {
        const rowAO = String(row[aoIdx] ?? '').trim();
        if (rowAO && rowAO !== filters.accountOwner) return false;
      }
      if (filters.account && acctIdx >= 0 && String(row[acctIdx] ?? '').trim() !== filters.account) return false;
      return true;
    });

    const EPOCH = new Date(0);
    const sorted = rows.map(r => ({ date: parseDate(r[dateIdx]) || EPOCH, row: r }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const firstActual = sorted.find(x => x.date.getTime() > 0)?.date;
    if (!firstActual) {
      return NextResponse.json({ success: true, periodic: [], indices: {} });
    }

    const now = new Date();
    const interval: '1mo'|'1wk'|'1d' = filters.chartInterval || '1mo';
    
    const allPeriods: string[] = [];
    let cur = new Date(Date.UTC(firstActual.getUTCFullYear(), firstActual.getUTCMonth(), 1));
    if (interval === '1mo') {
      while (toYYYYMM(cur) <= toYYYYMM(now)) {
        allPeriods.push(toYYYYMM(cur));
        cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      }
    } else if (interval === '1wk') {
      cur = new Date(firstActual);
      while (cur.getUTCDay() !== 5) cur.setUTCDate(cur.getUTCDate() + 1);
      while (cur <= now) {
        allPeriods.push(toYYYYMMDD(cur));
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
      if (allPeriods[allPeriods.length - 1] !== toYYYYMMDD(now)) {
        allPeriods.push(toYYYYMMDD(now));
      }
    } else { // '1d'
      cur = new Date(firstActual);
      while (cur <= now) {
        if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) {
          allPeriods.push(toYYYYMMDD(cur));
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    let analyzePeriods = allPeriods.slice(interval === '1mo' ? -13 : interval === '1wk' ? -52 : -260);

    const periodEndDates = analyzePeriods.map(p => {
      if (interval === '1mo') {
        const [y, m] = p.split('-').map(Number);
        return new Date(Date.UTC(y, m, 0, 23, 59, 59));
      }
      const [y, m, d] = p.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
    });

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
    const periodicStates: Record<string, State> = {};

    let txIdx = 0;
    for (let i = 0; i < analyzePeriods.length; i++) {
      const p = analyzePeriods[i];
      const endDt = periodEndDates[i];
      
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
        const tax     = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
        const charge  = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;

        const isRealInvestment = name === '투자금';
        if (!runningState.cashFX[region]) runningState.cashFX[region] = 0;
        const effRate = rate > 0 ? rate : (runningState.latestRate[region] || 1);
        if (rate > 0) runningState.latestRate[region] = rate;

        if (t.startsWith('dep')) {
          runningState.cashFX[region] += price - tax - charge;
          if (isRealInvestment) runningState.netDepositKRW += Math.floor((price - tax - charge) * effRate);
        } else if (t.startsWith('with')) {
          runningState.cashFX[region] -= price + tax + charge;
          if (isRealInvestment) runningState.netDepositKRW -= Math.floor((price + tax + charge) * effRate);
        } else if (t === 'buy') {
          const tot = price * qty + tax + charge;
          runningState.cashFX[region] -= tot;
          if (!runningState.positions[ticker]) {
            runningState.positions[ticker] = { qty: 0, buyCostFX: 0, buyCostKRW: 0, region, assetType: asset, name, lastRate: effRate };
          }
          const pos = runningState.positions[ticker];
          pos.qty += qty;
          pos.buyCostFX += price * qty;
          pos.buyCostKRW += (price * qty) * effRate;
          pos.lastRate = effRate;
        } else if (t === 'sell') {
          const tot = price * qty - tax - charge;
          runningState.cashFX[region] += tot;
          const pos = runningState.positions[ticker];
          if (pos && pos.qty > 0) {
            const fraction = qty / pos.qty;
            pos.qty = Math.max(0, pos.qty - qty);
            pos.buyCostFX = Math.max(0, pos.buyCostFX - pos.buyCostFX * fraction);
            pos.buyCostKRW = Math.max(0, pos.buyCostKRW - pos.buyCostKRW * fraction);
          }
        }
      }
      periodicStates[p] = cloneState(runningState);
    }

    const currentState = periodicStates[analyzePeriods[analyzePeriods.length - 1]] || runningState;
    const allStateTickers = new Set<string>();
    Object.values(periodicStates).forEach(st => {
      Object.entries(st.positions).forEach(([t, p]) => {
        if (p.qty > 0.0001) allStateTickers.add(t);
      });
    });

    const fetches = await Promise.all([
      ...Array.from(allStateTickers).map(tk => {
        const p = currentState.positions[tk] || Object.values(periodicStates).map(s => s.positions[tk]).find(x => x);
        const ytk = p ? toYahooTicker(tk, p.region === 'US' ? 'USD' : 'KRW') : tk;
        return fetchPeriodicCloses(ytk, interval, 15).catch(() => [] as { period: string; close: number }[])
          .then(data => ({ ticker: tk, data }));
      }),
      fetchPeriodicCloses('^KS11', interval, 15).then(d => ({ ticker: 'KOSPI',  data: d })).catch(() => ({ ticker: 'KOSPI',  data: [] })),
      fetchPeriodicCloses('^GSPC', interval, 15).then(d => ({ ticker: 'SP500',  data: d })).catch(() => ({ ticker: 'SP500',  data: [] })),
      fetchPeriodicCloses('^IXIC', interval, 15).then(d => ({ ticker: 'NASDAQ', data: d })).catch(() => ({ ticker: 'NASDAQ', data: [] })),
    ]);

    const tickerPrices: Record<string, Record<string, number>> = {};
    fetches.forEach(f => {
      tickerPrices[f.ticker] = {};
      f.data.forEach(d => { tickerPrices[f.ticker][d.period] = d.close; });
    });

    const indices: Record<string, { period: string; returnPct: number }[]> = {};
    ['KOSPI', 'SP500', 'NASDAQ'].forEach(name => {
      const d = fetches.find(f => f.ticker === name)?.data || [];
      const filtered = d.filter(x => analyzePeriods.includes(x.period));
      if (filtered.length === 0) { indices[name] = []; return; }
      const base = filtered[0].close;
      indices[name] = filtered.map(x => ({
        period: x.period,
        returnPct: base > 0 ? ((x.close - base) / base) * 100 : 0,
      }));
    });

    const periodic = analyzePeriods.map(p => {
      const state = periodicStates[p];
      if (!state) return { period: p, returnPct: 0 };

      let marketValueKRW = 0;
      Object.entries(state.positions).forEach(([tk, pos]) => {
        if (pos.qty < 0.0001) return;
        const prices = tickerPrices[tk] || {};
        let cp = prices[p];
        if (!cp) {
          const pKeys = Object.keys(prices).sort();
          for (let i = pKeys.length - 1; i >= 0; i--) {
            if (pKeys[i] <= p) { cp = prices[pKeys[i]]; break; }
          }
        }
        if (!cp) cp = pos.buyCostFX / pos.qty; 
        marketValueKRW += (cp * pos.qty) * (state.latestRate[pos.region] || 1);
      });

      Object.entries(state.cashFX).forEach(([reg, amt]) => {
        marketValueKRW += amt * (state.latestRate[reg] || 1);
      });

      const netInvKRW = state.netDepositKRW;
      const returnPct = netInvKRW > 0 ? ((marketValueKRW - netInvKRW) / netInvKRW) * 100 : 0;
      return { period: p, returnPct, marketValueKRW, netInvestmentKRW: netInvKRW };
    });

    return NextResponse.json({ success: true, periodic, indices });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
