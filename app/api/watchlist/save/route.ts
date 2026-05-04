import { NextRequest, NextResponse } from 'next/server';
import { getSheets, getSheetValues, appendRow, deleteRow } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const WATCHLIST_SHEET_NAME = 'Favorate';
const WATCHLIST_HEADERS    = ['Group', 'Region', 'Ticker'];

/**
 * POST /api/watchlist/save
 * Body: {
 *   owner,
 *   newItems?:      [{ group, region, ticker }]
 *   deleteTickers?: [{ ticker, group? }]   ← group 지정 시 해당 그룹 항목만 삭제
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, newItems, deleteTickers } = await req.json().catch(() => ({}));
    if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 });

    const spreadsheetId = getOwnerSheetId(owner);

    // ── 시트 존재 확인 / 없으면 자동 생성 ──────────────────
    let data: any[][];
    let sheetExists = true;
    try {
      data = await getSheetValues(spreadsheetId, WATCHLIST_SHEET_NAME);
    } catch {
      sheetExists = false;
      data = [WATCHLIST_HEADERS];
    }

    if (!sheetExists) {
      const sheets = await getSheets();
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: WATCHLIST_SHEET_NAME } } }],
        },
      });
      // 헤더 행 기록
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${WATCHLIST_SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [WATCHLIST_HEADERS] },
      });
      data = [WATCHLIST_HEADERS];
    }

    const headers   = (data[0] || []).map((h: any) => String(h ?? '').trim());
    const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
    const groupIdx  = headers.findIndex((h: string) => h === 'Group');
    const regionIdx = headers.findIndex((h: string) => h === 'Region');

    let deletedCount = 0;
    let addedCount   = 0;

    // ── 삭제 (역순으로 행 번호 삭제하여 인덱스 유지) ────────
    if (deleteTickers && Array.isArray(deleteTickers) && deleteTickers.length > 0 && tickerIdx !== -1) {
      const rows = data.slice(1);
      const rowsToDelete: number[] = [];

      for (const item of deleteTickers) {
        const inputTicker = String(item.ticker ?? item).trim().toUpperCase();
        const inputGroup  = item.group !== undefined ? String(item.group).trim() : null;

        rows.forEach((row: any[], i: number) => {
          const sheetTicker = String(row[tickerIdx] ?? '').trim().toUpperCase();
          const sheetGroup  = groupIdx !== -1 ? String(row[groupIdx] ?? '').trim() : '';
          const tickerMatch = sheetTicker === inputTicker;
          const groupMatch  = inputGroup === null || sheetGroup === inputGroup;
          if (tickerMatch && groupMatch) rowsToDelete.push(i + 2); // 1-indexed (+1 header)
        });
      }

      rowsToDelete.sort((a, b) => b - a); // 역순 정렬
      for (const sheetRow of rowsToDelete) {
        await deleteRow(spreadsheetId, WATCHLIST_SHEET_NAME, sheetRow);
        deletedCount++;
      }
    }

    // ── 추가 ────────────────────────────────────────────────
    if (newItems && Array.isArray(newItems) && newItems.length > 0) {
      for (const item of newItems) {
        const row: any[] = new Array(headers.length).fill('');
        if (groupIdx  !== -1) row[groupIdx]  = item.group  || '';
        if (regionIdx !== -1) row[regionIdx] = item.region || '';
        if (tickerIdx !== -1) row[tickerIdx] = String(item.ticker || '').trim().toUpperCase();
        await appendRow(spreadsheetId, WATCHLIST_SHEET_NAME, row);
        addedCount++;
      }
    }

    return NextResponse.json({
      message: '저장 완료',
      added:   addedCount,
      deleted: deletedCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
