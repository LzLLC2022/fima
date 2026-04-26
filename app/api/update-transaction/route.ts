import { NextRequest, NextResponse } from 'next/server';
import { updateRow, LEDGER_SHEET_NAME } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const { sheetRow, fields: f } = await req.json();

    if (!sheetRow || sheetRow < 2) {
      return NextResponse.json({ success: false, error: '유효하지 않은 행 번호' }, { status: 400 });
    }

    const toNum = (v: any) =>
      (v !== '' && v !== null && v !== undefined) ? (parseFloat(v) || 0) : '';

    const values = [
      String(f.date || ''),
      f.accountOwner || '',
      f.account      || '',
      f.region       || '',
      f.assetType    || '',
      f.ticker       || '',
      f.name         || '',
      f.trade        || '',
      toNum(f.price),
      (f.currency !== '' && f.currency !== null && f.currency !== undefined)
        ? (parseFloat(f.currency) || '')
        : '',
      toNum(f.quantity),
      toNum(f.dividend),
      toNum(f.tax),
      toNum(f.charge),
      toNum(f.purchase),
      toNum(f.purchaseCurrency),
      f.comment || '',
    ];

    await updateRow(LEDGER_SHEET_NAME, sheetRow, values);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
