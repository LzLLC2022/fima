import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const filters = await req.json();
    const spreadsheetId = getOwnerSheetId(filters.owner);

    const data = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (data.length < 2) return NextResponse.json({ success: true, headers: [], data: [], rowIndices: [] });

    const headers    = data[0].map((h: any) => String(h ?? '').trim());
    const rows       = data.slice(1);
    const dateIdx    = headers.indexOf('Date');
    const accountIdx = headers.indexOf('Account');
    const tickerIdx  = headers.indexOf('Ticker');

    // 인덱스 보존하면서 필터 (sheetRow = 시트 행 번호, 1-indexed, 헤더=1이므로 i+2)
    const filteredWithIdx = rows
      .map((row: any[], i: number) => ({ row, sheetRow: i + 2 }))
      .filter(({ row }) => {
        if (filters.startDate || filters.endDate) {
          const rawDate = row[dateIdx];
          let rowDate: Date;
          if (typeof rawDate === 'string' && rawDate) {
            rowDate = new Date(rawDate);
          } else if (typeof rawDate === 'number') {
            rowDate = new Date((rawDate - 25569) * 86400 * 1000);
          } else {
            return false;
          }
          if (isNaN(rowDate.getTime())) return false;
          if (filters.startDate && rowDate < new Date(filters.startDate)) return false;
          if (filters.endDate) {
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59);
            if (rowDate > end) return false;
          }
        }
        if (filters.account && String(row[accountIdx] ?? '').trim() !== filters.account) return false;
        if (filters.ticker  && String(row[tickerIdx]  ?? '').trim().toUpperCase() !== String(filters.ticker).trim().toUpperCase()) return false;
        return true;
      });

    // 날짜 포맷 정규화
    const result = filteredWithIdx.map(({ row }) =>
      row.map((cell: any, i: number) => {
        if (i === dateIdx) {
          if (typeof cell === 'number') {
            const d = new Date((cell - 25569) * 86400 * 1000);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          }
          return cell ?? '';
        }
        return cell === null || cell === undefined ? '' : cell;
      })
    );

    const rowIndices = filteredWithIdx.map(({ sheetRow }) => sheetRow);

    return NextResponse.json({ success: true, headers, data: result, rowIndices });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, headers: [], data: [], rowIndices: [] }, { status: 500 });
  }
}
