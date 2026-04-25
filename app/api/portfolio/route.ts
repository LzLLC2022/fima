import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/sheets';
import { getStockPrice, getExchangeRate } from '@/lib/stock';

const EMPTY = { success: true, cash: [], stocks: [], funds: [],
                totalKRW: 0, totalCashKRW: 0, totalStockKRW: 0, totalFundKRW: 0 };

export async function POST(req: NextRequest) {
  const filters = await req.json().catch(() => ({}));

  try {
    // ── 기준일 파싱 ──
    let endDate: Date | null = null;
    if (filters.endDate) {
      const ep = String(filters.endDate).split('-');
      if (ep.length === 3) {
        endDate = new Date(Number(ep[0]), Number(ep[1]) - 1, Number(ep[2]));
        endDate.setHours(23, 59, 59);
      }
    }

    // ── 시트 데이터 읽기 ──
    const [ledgerData, masterData] = await Promise.all([
      getSheetValues(LEDGER_SHEET_NAME),
      getSheetValues(MASTER_SHEET_NAME).catch(() => [] as any[][]),
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
    const ownerIdx  = col('account owner');
    const acctIdx   = col('account');

    // ── Master → region-currency 매핑 ──
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
      if (filters.accountOwner && ownerIdx >= 0) {
        if (String(row[ownerIdx] ?? '').trim() !== filters.accountOwner) return false;
      }
      if (filters.account && acctIdx >= 0) {
        if (String(row[acctIdx] ?? '').trim() !== filters.account) return false;
      }
      return true;
    };

    // ── 거래 집계 ──
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
        p.buyCostKRW += price * qty * effRate;
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
          p.buyCostKRW += price * qty * effRate;
          p.divFX      += divAmt;
          p.divKRW     += divAmt * effRate;
        } else {
          p.divFX  += (divAmt || price);
          p.divKRW += (divAmt || price) * effRate;
        }
      }
    });

    // ── 기준일 문자열 (YYYY-MM-DD) ──
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const endDateStr = endDate
      ? `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-${pad2(endDate.getDate())}`
      : undefined;

    // ── 현재가 / 역사적 종가 병렬 조회 ──
    const tickers      = Object.keys(posMap);
    const priceResults = await Promise.allSettled(
      tickers.map(tk => getStockPrice(tk, endDateStr).catch(() => 0))
    );
    const priceMap: Record<string, number> = {};
    tickers.forEach((tk, i) => {
      const r = priceResults[i];
      priceMap[tk] = r.status === 'fulfilled' ? (Number(r.value) || 0) : 0;
    });

    // ── 환율 조회 (기준일 지정 시 역사적 환율, 없으면 현재 환율) ──
    const histRateMap: Record<string, number> = { KRW: 1 };
    const uniqueCurrencies = [...new Set([
      ...tickers.map(k => currencyMap[posMap[k].region] || 'KRW'),
      ...Object.keys(cashFX).map(r => currencyMap[r] || 'KRW'),
    ])].filter(c => c !== 'KRW');

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
    const stocks: any[] = [], funds: any[] = [];

    Object.keys(posMap).forEach(key => {
      const p            = posMap[key];
      const effectiveQty = p.buyQty + p.splitAdj;
      const netQty       = effectiveQty - p.sellQty;
      if (netQty < 0.0001) return;

      const avgPriceFX  = effectiveQty > 0 ? p.buyCostFX / effectiveQty : 0;
      const avgRate     = p.buyCostFX  > 0 ? p.buyCostKRW / p.buyCostFX : (p.lastRate || 1);
      const currency    = currencyMap[p.region] || 'KRW';
      const isKRW       = currency === 'KRW';
      const effRate2    = isKRW ? 1 : resolveRate(p.region, p.lastRate > 0 ? p.lastRate : (latestRate[p.region] || 1));

      const purchaseAmtKRW = isKRW ? avgPriceFX * netQty : avgPriceFX * netQty * avgRate;
      const curPriceFX     = priceMap[p.ticker] || 0;
      const marketValueKRW = isKRW ? curPriceFX * netQty : curPriceFX * netQty * effRate2;
      const pnl            = marketValueKRW - purchaseAmtKRW;
      const pnlPct         = purchaseAmtKRW > 0 ? pnl / purchaseAmtKRW * 100 : 0;

      const purchaseAmtFX = avgPriceFX * netQty;
      const marketValueFX = curPriceFX  * netQty;
      const pnlFX         = marketValueFX - purchaseAmtFX;

      const item = {
        ticker: p.ticker, name: p.name, currency, region: p.region,
        quantity: netQty, avgPrice: avgPriceFX,
        purchaseAmt  : purchaseAmtKRW, currentPrice: curPriceFX,
        marketValue  : marketValueKRW, pnl, pnlPct,
        purchaseAmtFX: isKRW ? purchaseAmtKRW : purchaseAmtFX,
        marketValueFX: isKRW ? marketValueKRW : marketValueFX,
        pnlFX        : isKRW ? pnl            : pnlFX,
        divFX: p.divFX, divKRW: p.divKRW,
      };

      const at = p.assetType.toLowerCase();
      if (at === 'stock' || at === 'etf') stocks.push(item);   // ETF → Stock(ETF) 섹션
      else if (at === 'fund')             funds.push(item);    // Fund만 Fund 섹션
    });

    stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
    funds.sort((a, b)  => a.ticker.localeCompare(b.ticker));

    // ── 현금 요약 ──
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
