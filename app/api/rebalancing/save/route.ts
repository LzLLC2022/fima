import { NextRequest, NextResponse } from 'next/server';
import { getSheets, getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const REBALANCING_SHEET_NAME = 'Rebalancing';

/**
 * POST /api/rebalancing/save
 * Body: { owner, items: [{ ticker, targetPct }] }
 *
 * Rebalancing 시트에서 각 ticker를 직접 찾아
 * 해당 행의 구성비중(%) 셀만 개별 업데이트
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

    const headers   = data[0].map((h: any) => String(h ?? '').trim());
    const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');
    const wgtIdx    = headers.findIndex((h: string) => h === '구성비중(%)');

    if (tickerIdx === -1) return NextResponse.json({ error: 'Ticker 컬럼 없음' }, { status: 400 });
    if (wgtIdx    === -1) return NextResponse.json({ error: '구성비중(%) 컬럼 없음' }, { status: 400 });

    const colLetter = String.fromCharCode(65 + wgtIdx); // 구성비중(%) 컬럼 문자 (A=65)
    const sheets    = await getSheets();
    const rows      = data.slice(1); // 헤더 제외

    let updatedCount = 0;

    for (const item of items) {
      const inputTicker = String(item.ticker ?? '').trim().toUpperCase();
      const inputBase   = inputTicker.replace(/\.(KS|KQ)$/, '');
      if (!inputTicker) continue;

      // Rebalancing 시트에서 해당 ticker 행 찾기
      const rowIdx = rows.findIndex((row: any[]) => {
        const sheetTicker = String(row[tickerIdx] ?? '').trim().toUpperCase();
        const sheetBase   = sheetTicker.replace(/\.(KS|KQ)$/, '');
        return sheetTicker === inputTicker || sheetBase === inputBase;
      });

      if (rowIdx === -1) continue; // 시트에 없는 종목은 건너뜀

      const sheetRow = rowIdx + 2; // 1-indexed: 헤더=1, 데이터 시작=2
      const range    = `${REBALANCING_SHEET_NAME}!${colLetter}${sheetRow}`;
      const newPct   = Number(item.targetPct) ?? 0;

      // 해당 셀 개별 업데이트
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newPct]] },
      });

      updatedCount++;
    }

    if (updatedCount === 0) {
      return NextResponse.json({ message: '업데이트할 항목 없음', updated: 0 });
    }

    return NextResponse.json({ message: '저장 완료', updated: updatedCount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
