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

    // 날짜 파싱
    const dateParts = String(f.date || '').split('-');
    const dateValue = dateParts.length === 3
      ? `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`
      : String(f.date || '');

    const toNum = (v: any) =>
      (v !== '' && v !== null && v !== undefined) ? (parseFloat(v) || 0) : '';

    await appendRow(spreadsheetId, LEDGER_SHEET_NAME, [
      dateValue,
      f.accountOwner || '',   // Account Owner (투자계좌 소유자)
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
    ]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
