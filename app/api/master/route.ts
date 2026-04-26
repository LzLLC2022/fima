import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, MASTER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const { owner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);
    const data = await getSheetValues(spreadsheetId, MASTER_SHEET_NAME);
    if (data.length < 1) return NextResponse.json({ error: 'Master 시트가 비어 있습니다.' });

    const headers = data[0].map((h: any) => String(h ?? '').trim());
    const rows    = data.slice(1);

    const colIdx = (name: string) =>
      headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase());

    const getColumnValues = (colName: string): string[] => {
      const idx = colIdx(colName);
      if (idx === -1) return [];
      return rows
        .map((r: any[]) => String(r[idx] ?? '').trim())
        .filter((v: string) => v !== '' && v !== 'undefined');
    };

    const regionIdx   = colIdx('Region');
    const currencyIdx = colIdx('Currency');
    const regions: { name: string; currency: string }[] = [];
    const seen = new Set<string>();

    rows.forEach((row: any[]) => {
      const region   = regionIdx   !== -1 ? String(row[regionIdx]   ?? '').trim() : '';
      const currency = currencyIdx !== -1 ? String(row[currencyIdx] ?? '').trim() : '';
      if (region && !seen.has(region)) {
        seen.add(region);
        regions.push({ name: region, currency });
      }
    });

    return NextResponse.json({
      accounts  : getColumnValues('Account'),
      regions,
      assetTypes: getColumnValues('Asset Type'),
      trades    : getColumnValues('Trade'),
    });
  } catch (e: any) {
    return NextResponse.json({ error: '데이터 읽기 오류: ' + e.message }, { status: 500 });
  }
}
