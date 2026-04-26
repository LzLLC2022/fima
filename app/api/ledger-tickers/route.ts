import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId, LEDGER_SHEET_NAME } from '@/lib/config';

/**
 * POST /api/ledger-tickers
 * Body: { owner: string, accountOwner?: string }
 * Returns: { ticker, name }[]  — Ledger 실제 거래 종목, 빈도 내림차순
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, accountOwner } = await req.json();
    const spreadsheetId = getOwnerSheetId(owner);

    const rows = await getSheetValues(spreadsheetId, LEDGER_SHEET_NAME);
    if (!rows || rows.length < 2) return NextResponse.json([]);

    const headers = rows[0].map((h: any) => String(h ?? '').trim().toLowerCase());
    const tickerIdx = headers.indexOf('ticker');
    const nameIdx   = headers.indexOf('name');
    const aoIdx     = headers.indexOf('account owner');
    const assetIdx  = headers.indexOf('asset type');

    if (tickerIdx < 0) return NextResponse.json([]);

    const countMap: Record<string, { name: string; count: number }> = {};

    rows.slice(1).forEach((row: any[]) => {
      // accountOwner 필터
      if (accountOwner && aoIdx >= 0 &&
          String(row[aoIdx] ?? '').trim() !== accountOwner) return;

      const ticker = String(row[tickerIdx] ?? '').trim().toUpperCase();
      const asset  = assetIdx >= 0 ? String(row[assetIdx] ?? '').trim().toLowerCase() : '';

      // 빈 Ticker 또는 Cash 제외
      if (!ticker || asset === 'cash') return;

      const name = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '';

      if (!countMap[ticker]) {
        countMap[ticker] = { name, count: 0 };
      }
      countMap[ticker].count++;
      // 이름이 비어 있으면 최초로 발견된 이름 사용
      if (name && !countMap[ticker].name) {
        countMap[ticker].name = name;
      }
    });

    const result = Object.entries(countMap)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([ticker, { name }]) => ({ ticker, name }));

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json([]);
  }
}
