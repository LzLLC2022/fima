import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const EMPTY = { success: true, totalBuyQty: 0, remainingQty: 0,
                avgPrice: 0, avgRate: 0, purchase: 0, purchaseFX: 0, purchaseCurrency: 0 };

export async function POST(req: NextRequest) {
  try {
    const { owner, ticker, sellQuantity } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const data = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (data.length < 2) return NextResponse.json(EMPTY);

    const headers    = data[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const tickerCol  = headers.indexOf('ticker');
    const tradeCol   = headers.indexOf('trade');
    const priceCol   = headers.indexOf('price');
    const qtyCol     = headers.indexOf('quantity');
    const currCol    = headers.indexOf('currency');

    if (tickerCol === -1) return NextResponse.json({ success: false, error: 'Ticker 컬럼 없음' });

    const rows        = data.slice(1);
    const upperTicker = String(ticker).trim().toUpperCase();

    // Buy 이력 집계
    let totalBuyQty  = 0, totalBuyCost = 0, totalBuyKRW = 0;
    rows.forEach((row: any[]) => {
      if (String(row[tickerCol] ?? '').trim().toUpperCase() !== upperTicker) return;
      const trade = String(row[tradeCol] ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      if (trade !== 'buy') return;
      const qty   = Number(row[qtyCol])   || 0;
      const price = Number(row[priceCol]) || 0;
      const rate  = currCol !== -1 ? (Number(row[currCol]) || 1) : 1;
      totalBuyQty  += qty;
      totalBuyCost += price * qty;
      totalBuyKRW  += price * qty * rate;
    });

    // 분할/병합 수량 조정
    let totalAdjQty = 0;
    rows.forEach((row: any[]) => {
      if (String(row[tickerCol] ?? '').trim().toUpperCase() !== upperTicker) return;
      const trade = String(row[tradeCol] ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      const qty   = Math.abs(Number(row[qtyCol]) || 0);
      if (trade === 'split')                                totalAdjQty += qty;
      if (trade === 'merge' || trade === 'reversesplit')    totalAdjQty -= qty;
    });

    const effectiveTotalQty = totalBuyQty + totalAdjQty;

    // Sell 이력
    let totalSellQty = 0;
    rows.forEach((row: any[]) => {
      if (String(row[tickerCol] ?? '').trim().toUpperCase() !== upperTicker) return;
      const trade = String(row[tradeCol] ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      if (trade !== 'sell') return;
      totalSellQty += Number(row[qtyCol]) || 0;
    });

    const remainingQty = effectiveTotalQty - totalSellQty;
    if (effectiveTotalQty === 0) return NextResponse.json(EMPTY);

    const avgPrice = totalBuyCost / effectiveTotalQty;
    const avgRate  = totalBuyCost > 0 ? totalBuyKRW / totalBuyCost : 1;
    const purchase = avgPrice * Number(sellQuantity) * avgRate;

    return NextResponse.json({
      success         : true,
      totalBuyQty     : effectiveTotalQty,
      remainingQty,
      avgPrice,
      avgRate,
      purchase,
      purchaseFX      : avgPrice * Number(sellQuantity),
      purchaseCurrency: avgRate,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message });
  }
}
