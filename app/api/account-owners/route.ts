import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, MASTER_SHEET_NAME } from '@/lib/config';

/**
 * POST /api/account-owners
 * Body: { owner: string }
 * Returns: { owners: string[] }  — Master 시트 'Account Owner' 컬럼 값 목록
 *
 * Master 시트 구조 (컬럼 예시):
 *   A: Account Owner | B: Account | C: Region | D: Currency | E: Asset Type | F: Trade
 */
export async function POST(req: NextRequest) {
  try {
    const { owner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const rows = await getSheetValues(spreadsheetId, MASTER_SHEET_NAME);
    if (!rows || rows.length < 2) return NextResponse.json({ owners: [] });

    const headers = rows[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const aoIdx   = headers.indexOf('account owner');
    if (aoIdx < 0) return NextResponse.json({ owners: [] });

    const owners = rows.slice(1)
      .map((row: any[]) => String(row[aoIdx] ?? '').trim())
      .filter(Boolean);  // 빈 값 제거 (순서 유지, 중복 허용 안 함)

    // 순서 유지하면서 중복 제거
    const seen = new Set<string>();
    const result: string[] = [];
    owners.forEach(v => { if (!seen.has(v)) { seen.add(v); result.push(v); } });

    return NextResponse.json({ owners: result });
  } catch (e: any) {
    return NextResponse.json({ owners: [], error: e.message });
  }
}
