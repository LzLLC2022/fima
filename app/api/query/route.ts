import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const filters = await req.json();

    const data = await getSheetValues(LEDGER_SHEET_NAME);
    if (data.length < 2) return NextResponse.json({ success: true, headers: [], data: [] });

    const headers    = data[0].map((h: any) => String(h ?? '').trim());
    const rows       = data.slice(1);
    const dateIdx    = headers.indexOf('Date');
    const ownerIdx   = headers.indexOf('Account Owner');
    const accountIdx = headers.indexOf('Account');

    const filtered = rows.filter((row: any[]) => {
      // 날짜 필터
      if (filters.startDate || filters.endDate) {
        const rawDate = row[dateIdx];
        let rowDate: Date;
        if (typeof rawDate === 'string' && rawDate) {
          rowDate = new Date(rawDate);
        } else if (typeof rawDate === 'number') {
          // Google Sheets 직렬 날짜 변환 (1900-01-01 기준)
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
      if (filters.accountOwner && String(row[ownerIdx]   ?? '').trim() !== filters.accountOwner) return false;
      if (filters.account      && String(row[accountIdx] ?? '').trim() !== filters.account)      return false;
      return true;
    });

    // 날짜 포맷 정규화
    const result = filtered.map((row: any[]) =>
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

    return NextResponse.json({ success: true, headers, data: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, headers: [], data: [] }, { status: 500 });
  }
}
