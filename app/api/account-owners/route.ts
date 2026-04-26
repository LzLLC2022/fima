import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, LEDGER_SHEET_NAME } from '@/lib/config';

/**
 * POST /api/account-owners
 * Body: { owner: string }
 * Returns: { owners: string[] }  — Ledger 시트 'Account Owner' 컬럼 고유값 목록
 */
export async function POST(req: NextRequest) {
  try {
    const { owner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const rows = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (!rows || rows.length < 2) return NextResponse.json({ owners: [] });

    const headers = rows[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const aoIdx   = headers.indexOf('account owner');
    if (aoIdx < 0) return NextResponse.json({ owners: [] });

    const seen = new Set<string>();
    rows.slice(1).forEach((row: any[]) => {
      const v = String(row[aoIdx] ?? '').trim();
      if (v) seen.add(v);
    });

    return NextResponse.json({ owners: Array.from(seen).sort() });
  } catch (e: any) {
    return NextResponse.json({ owners: [], error: e.message });
  }
}
