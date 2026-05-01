import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

/**
 * KOREA 현금 잔액 디버그 엔드포인트
 * POST /api/cash-debug  { owner, accountOwner }
 * → KOREA cashFX 변동 trace 반환
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, accountOwner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const ledgerData = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (ledgerData.length < 2) return NextResponse.json({ trace: [], final: 0 });

    const headers = ledgerData[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const col = (n: string) => headers.indexOf(n.toLowerCase());

    const regionIdx = col('region');
    const assetIdx  = col('asset type');
    const tradeIdx  = col('trade');
    const priceIdx  = col('price');
    const qtyIdx    = col('quantity');
    const divIdx    = col('dividend');
    const taxIdx    = col('tax');
    const chgIdx    = col('charge');
    const dateIdx   = col('date');
    const nameIdx   = col('name');
    const aoIdx     = col('account owner');

    let koreaBalance = 0;
    const trace: any[] = [];

    ledgerData.slice(1).forEach((row: any[], i: number) => {
      if (accountOwner && aoIdx >= 0) {
        if (String(row[aoIdx] ?? '').trim() !== accountOwner) return;
      }

      const t      = String(row[tradeIdx]  ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
      const region = String(row[regionIdx] ?? '').trim();
      if (region !== 'KOREA') return;

      const asset  = String(row[assetIdx]  ?? '').trim();
      const price  = Number(row[priceIdx]) || 0;
      const qty    = Number(row[qtyIdx])   || 0;
      const divAmt = Number(row[divIdx])   || 0;
      const tax    = taxIdx >= 0 ? (Number(row[taxIdx]) || 0) : 0;
      const charge = chgIdx >= 0 ? (Number(row[chgIdx]) || 0) : 0;
      const date   = dateIdx >= 0 ? String(row[dateIdx] ?? '') : '';
      const name   = nameIdx >= 0 ? String(row[nameIdx] ?? '') : '';

      const prev = koreaBalance;
      let delta = 0;

      if (t.startsWith('dep')) {
        delta = price - tax - charge;
        koreaBalance += delta;
      } else if (t.startsWith('with')) {
        delta = -(price + tax + charge);
        koreaBalance += delta;
      } else if (t === 'buy') {
        if (asset.toLowerCase() === 'cash') {
          delta = price * (qty || 1);
        } else {
          delta = -(price * qty + charge);
        }
        koreaBalance += delta;
      } else if (t === 'sell') {
        delta = price * qty - tax - charge;
        koreaBalance += delta;
      } else if (t.startsWith('div') && !t.includes('stock')) {
        delta = (divAmt || price) - tax - charge;
        koreaBalance += delta;
      } else if (t.includes('stock')) {
        delta = divAmt - price * qty - charge - tax;
        koreaBalance += delta;
      } else {
        return; // no cash effect, skip
      }

      trace.push({
        sheetRow: i + 2,
        date,
        trade: t,
        name,
        price, qty, divAmt, tax, charge,
        delta,
        balance: koreaBalance,
        rawPrice: row[priceIdx],   // raw value from sheet
        rawDiv:   row[divIdx],
        rawTax:   row[taxIdx],
        rawChg:   row[chgIdx],
      });
    });

    return NextResponse.json({ trace, final: koreaBalance, totalRows: ledgerData.length - 1 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
