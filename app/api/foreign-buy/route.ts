import { NextRequest, NextResponse } from 'next/server';
import { appendRow, LEDGER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const f = await req.json();

    if (!String(f.accountOwner ?? '').trim()) {
      return NextResponse.json(
        { success: false, error: 'Account Owner는 필수 항목입니다.' },
        { status: 400 },
      );
    }

    const spreadsheetId = getOwnerSheetId(f.owner);

    const dateParts = String(f.date || '').split('-');
    const dateValue = dateParts.length === 3
      ? `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`
      : String(f.date || '');

    const toNum = (v: any) =>
      (v !== '' && v !== null && v !== undefined) ? (parseFloat(v) || 0) : '';

    const price        = parseFloat(f.price)      || 0;
    const qty          = parseFloat(f.quantity)   || 0;
    const rate         = parseFloat(f.currency)   || 1;
    const charge       = parseFloat(f.charge)     || 0;
    const existingFX   = parseFloat(f.existingFX) || 0;
    const exchangeType = f.exchangeType || 'none';
    const krwRegion    = f.krwRegion    || 'KOREA';
    const totalFX      = price * qty + charge;
    const convertFX    = exchangeType === 'full'    ? totalFX
                       : exchangeType === 'partial' ? Math.max(0, totalFX - existingFX)
                       : 0;
    const withdrawKRW  = convertFX * rate;

    const acct = f.account || '';
    const note = f.comment || '';
    const rows: any[][] = [];

    const accountOwner = String(f.accountOwner).trim();

    // ① Withdraw (KRW 출금) — 환전 시에만
    if (convertFX > 0) {
      rows.push([dateValue, accountOwner, acct, krwRegion, 'Cash', '', '환전',
                 'Withdraw', withdrawKRW, '', '', '', '', '', '', '',
                 note ? note + ' [환전출금]' : '환전출금']);

      // ② Deposit (외화 입금)
      rows.push([dateValue, accountOwner, acct, f.region, 'Cash', '', '환전',
                 'Deposit', convertFX, rate, '', '', '', '', '', '',
                 note ? note + ' [환전입금]' : '환전입금']);
    }

    // ③ Buy (주식 매입)
    rows.push([
      dateValue, accountOwner, acct,
      f.region, f.assetType || '',
      f.ticker || '', f.name || '',
      f.trade  || 'Buy',
      toNum(f.price),
      parseFloat(f.currency) || '',
      toNum(f.quantity),
      '', '',
      toNum(f.charge),
      toNum(f.purchase),
      toNum(f.purchaseCurrency),
      note,
    ]);

    for (const row of rows) {
      await appendRow(spreadsheetId, LEDGER_SHEET_NAME, row);
    }

    return NextResponse.json({ success: true, recordsCreated: rows.length });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
