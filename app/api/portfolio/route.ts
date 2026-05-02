import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME, MASTER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';
import { getStockPrice, getExchangeRate, getNaverBondInfo, BOND_META, getAnnualDividendPerShare } from '@/lib/stock';

function isKoreanBondISIN(ticker: string): boolean {
  return /^KR[A-Z0-9]{10}$/i.test(ticker.trim());
}

/**
 * 만기보유시 평가 계산
 * - 남은 쿠폰 지급일(반기) 합산 + 원금(액면가×수량)
 * - purchaseAmtFX: 총 매입금액(현지통화 기준)
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

const EMPTY = { success: true, cash: [], stocks: [], funds: [],
                totalKRW: 0, totalCashKRW: 0, totalStockKRW: 0, totalFundKRW: 0 };

export async function POST(req: NextRequest) {
  const filters = await req.json().catch(() => ({}));

  try {
    const spreadsheetId = getOwnerSheetId(filters.owner);

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
      if (filters.accountOwner && aoIdx >= 0) {
        if (String(row[aoIdx] ?? '').trim() !== filters.accountOwner) return false;
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

    // ── 현재가 / 역사적 종가 + 연배당 병렬 조회 ──
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
      // 현재가 조회 불가(0)인 경우: Bond ISIN이면 매입단가로 대체 (평가손실 0%)
      const rawPriceFX  = priceMap[p.ticker] || 0;
      const curPriceFX  = rawPriceFX > 0 ? rawPriceFX
                        : isKoreanBondISIN(p.ticker) ? avgPriceFX : 0;
      const marketValueKRW = isKRW ? curPriceFX * netQty : curPriceFX * netQty * effRate2;
      const pnl            = marketValueKRW - purchaseAmtKRW;
      const pnlPct         = purchaseAmtKRW > 0 ? pnl / purchaseAmtKRW * 100 : 0;

      const purchaseAmtFX = avgPriceFX * netQty;
      const marketValueFX = curPriceFX  * netQty;
      const pnlFX         = marketValueFX - purchaseAmtFX;

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

      const at = p.assetType.toLowerCase();
      if (at === 'stock' || at === 'etf')    stocks.push(item);   // Stock(ETF) 섹션
      else if (at === 'fund' || at === 'bond') funds.push(item);  // Fund/Bond 섹션
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
