import { NextRequest, NextResponse } from 'next/server';
import { deleteRow, LEDGER_SHEET_NAME } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const { sheetRow } = await req.json();

    if (!sheetRow || sheetRow < 2) {
      return NextResponse.json({ success: false, error: '유효하지 않은 행 번호' }, { status: 400 });
    }

    await deleteRow(LEDGER_SHEET_NAME, sheetRow);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
