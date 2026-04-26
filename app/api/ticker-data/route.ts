import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const { owner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const data = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (data.length < 2) return NextResponse.json([]);

    const headers  = data[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const tickerCol = headers.indexOf('ticker');
    const nameCol   = headers.indexOf('name');
    if (tickerCol === -1) return NextResponse.json([]);

    const tickerMap: Record<string, string> = {};
    data.slice(1).forEach((row: any[]) => {
      const ticker = String(row[tickerCol] ?? '').trim();
      const name   = nameCol !== -1 ? String(row[nameCol] ?? '').trim() : '';
      if (ticker && !tickerMap[ticker]) tickerMap[ticker] = name;
    });

    return NextResponse.json(
      Object.entries(tickerMap)
        .map(([ticker, name]) => ({ ticker, name }))
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
    );
  } catch {
    return NextResponse.json([]);
  }
}
