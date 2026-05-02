import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, batchUpdateCells } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const REBALANCING_SHEET_NAME = 'Rebalancing';

/**
 * POST /api/rebalancing/save
 * Body: { owner, items: [{ ticker, targetPct }] }
 * Updates 구성비중(%) column in Rebalancing sheet for matching tickers
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, items } = await req.json().catch(() => ({}));
    if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items 필요' }, { status: 400 });
    }

    const spreadsheetId = getOwnerSheetId(owner);
    const data = await getSheetValues(spreadsheetId, REBALANCING_SHEET_NAME);

    if (!data || data.length < 2) {
      return NextResponse.json({ error: '시트 데이터 없음' }, { status: 404 });
    }

    const headers = data[0].map((h: any) => String(h ?? '').trim());
    const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
    const wgtIdx    = headers.findIndex((h: string) => h === '구성비중(%)');

    if (tickerIdx === -1) return NextResponse.json({ error: 'Ticker 컬럼 없음' }, { status: 400 });
    if (wgtIdx === -1)    return NextResponse.json({ error: '구성비중(%) 컬럼 없음' }, { status: 400 });

    // Build a map: ticker → targetPct
    const updateMap: Record<string, number> = {};
    for (const it of items) {
      if (it.ticker) updateMap[String(it.ticker).trim().toUpperCase()] = Number(it.targetPct) ?? 0;
    }

    // Collect updates: match rows by ticker (rows are 0-indexed; row 0 = header, so sheet row = i+1+1 = i+2)
    const updates: { range: string; value: any }[] = [];
    const rows = data.slice(1);
    rows.forEach((row: any[], i: number) => {
      const ticker = String(row[tickerIdx] ?? '').trim().toUpperCase();
      if (!ticker) return;
      // Try exact match, then .KS/.KQ stripped
      const base = ticker.replace(/\.(KS|KQ)$/, '');
      const newPct = updateMap[ticker] ?? updateMap[base] ?? null;
      if (newPct === null) return;

      const sheetRow = i + 2; // 1-indexed: header is row 1, first data is row 2
      const colLetter = String.fromCharCode(65 + wgtIdx); // A=65
      updates.push({ range: `${REBALANCING_SHEET_NAME}!${colLetter}${sheetRow}`, value: newPct });
    });

    if (updates.length === 0) {
      return NextResponse.json({ message: '업데이트할 항목 없음', updated: 0 });
    }

    await batchUpdateCells(spreadsheetId, updates);

    return NextResponse.json({ message: '저장 완료', updated: updates.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
