import { NextRequest, NextResponse } from 'next/server';
import { getSheets, getSheetValues, appendRow, deleteRow } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const REBALANCING_SHEET_NAME = 'Rebalancing';

/**
 * POST /api/rebalancing/save
 * Body: {
 *   owner,
 *   region?,
 *   items?:         [{ ticker, targetPct }]          — 기존 항목 비중 수정
 *   newItems?:      [{ region, ticker, name, targetPct, divCycle?, divCount? }]  — 새 종목 추가
 *   deleteTickers?: string[]                         — 삭제할 종목 ticker 목록
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, region, items, newItems, deleteTickers } = await req.json().catch(() => ({}));
    if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 });

    const spreadsheetId = getOwnerSheetId(owner);
    const data = await getSheetValues(spreadsheetId, REBALANCING_SHEET_NAME);

    if (!data || data.length < 2) {
      return NextResponse.json({ error: '시트 데이터 없음' }, { status: 404 });
    }

    const headers   = data[0].map((h: any) => String(h ?? '').trim());
    const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
    const wgtIdx    = headers.findIndex((h: string) => h === '구성비중(%)');
    const regionIdx = headers.findIndex((h: string) => h === 'Region');
    const nameIdx   = headers.findIndex((h: string) => h === 'Name');
    const freqIdx   = headers.findIndex((h: string) => h === '연배당주기');
    const cntIdx    = headers.findIndex((h: string) => h === '연배당횟수');

    if (tickerIdx === -1) return NextResponse.json({ error: 'Ticker 컬럼 없음' }, { status: 400 });

    const sheets = await getSheets();
    let updatedCount = 0;
    let deletedCount = 0;
    let addedCount   = 0;

    // ── 1. 기존 항목 비중 업데이트 ─────────────────────────
    if (items && Array.isArray(items) && items.length > 0 && wgtIdx !== -1) {
      const colLetter = String.fromCharCode(65 + wgtIdx);
      const rows = data.slice(1);

      for (const item of items) {
        const inputTicker = String(item.ticker ?? '').trim().toUpperCase();
        const inputBase   = inputTicker.replace(/\.(KS|KQ)$/, '');
        if (!inputTicker) continue;

        const rowIdx = rows.findIndex((row: any[]) => {
          const sheetTicker = String(row[tickerIdx] ?? '').trim().toUpperCase();
          const sheetBase   = sheetTicker.replace(/\.(KS|KQ)$/, '');
          return sheetTicker === inputTicker || sheetBase === inputBase;
        });

        if (rowIdx === -1) continue;

        const sheetRow = rowIdx + 2; // 1-indexed: 헤더=1, 데이터 시작=2
        const range    = `${REBALANCING_SHEET_NAME}!${colLetter}${sheetRow}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[Number(item.targetPct) ?? 0]] },
        });
        updatedCount++;
      }
    }

    // ── 2. 종목 삭제 (역순으로 삭제하여 행 인덱스 유지) ─────
    if (deleteTickers && Array.isArray(deleteTickers) && deleteTickers.length > 0) {
      const rows = data.slice(1);
      const rowsToDelete: number[] = [];

      for (const ticker of deleteTickers) {
        const inputTicker = String(ticker).trim().toUpperCase();
        const inputBase   = inputTicker.replace(/\.(KS|KQ)$/, '');

        const rowIdx = rows.findIndex((row: any[]) => {
          const sheetTicker = String(row[tickerIdx] ?? '').trim().toUpperCase();
          const sheetBase   = sheetTicker.replace(/\.(KS|KQ)$/, '');
          return sheetTicker === inputTicker || sheetBase === inputBase;
        });

        if (rowIdx !== -1) rowsToDelete.push(rowIdx + 2); // 1-indexed (+1 header)
      }

      // 아래 행부터 삭제 (인덱스 밀림 방지)
      rowsToDelete.sort((a, b) => b - a);
      for (const sheetRow of rowsToDelete) {
        await deleteRow(spreadsheetId, REBALANCING_SHEET_NAME, sheetRow);
        deletedCount++;
      }
    }

    // ── 3. 새 종목 추가 ────────────────────────────────────
    if (newItems && Array.isArray(newItems) && newItems.length > 0) {
      for (const item of newItems) {
        // 헤더 컬럼 순서에 맞게 행 구성
        const row: any[] = new Array(headers.length).fill('');
        if (regionIdx !== -1) row[regionIdx] = item.region || region || '';
        if (tickerIdx !== -1) row[tickerIdx] = String(item.ticker || '').trim().toUpperCase();
        if (nameIdx   !== -1) row[nameIdx]   = item.name || '';
        if (freqIdx   !== -1) row[freqIdx]   = item.divCycle || '';
        if (cntIdx    !== -1) row[cntIdx]    = Number(item.divCount) || '';
        if (wgtIdx    !== -1) row[wgtIdx]    = Number(item.targetPct) || 0;

        await appendRow(spreadsheetId, REBALANCING_SHEET_NAME, row);
        addedCount++;
      }
    }

    const totalOps = updatedCount + deletedCount + addedCount;
    if (totalOps === 0) {
      return NextResponse.json({ message: '업데이트할 항목 없음', updated: 0, deleted: 0, added: 0 });
    }

    return NextResponse.json({
      message: '저장 완료',
      updated: updatedCount,
      deleted: deletedCount,
      added:   addedCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
