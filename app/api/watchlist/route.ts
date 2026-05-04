import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';
import { getStockInfo, get52WeekHighLow } from '@/lib/stock';

const WATCHLIST_SHEET_NAME = 'Favorate';

/**
 * POST /api/watchlist
 * Body: { owner }
 *
 * Watchlist 시트 구조 (헤더):
 *   Group | Region | Ticker
 *
 * 반환: { items: [{ group, region, ticker, name, price, changePct, currency, weekHigh52, weekLow52 }] }
 */
export async function POST(req: NextRequest) {
  try {
    const { owner } = await req.json().catch(() => ({}));
    if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 });

    const spreadsheetId = getOwnerSheetId(owner);

    let data: any[][];
    try {
      data = await getSheetValues(spreadsheetId, WATCHLIST_SHEET_NAME);
    } catch {
      // 시트가 아직 없으면 빈 목록 반환
      return NextResponse.json({ items: [] });
    }

    if (!data || data.length < 2) return NextResponse.json({ items: [] });

    const headers   = data[0].map((h: any) => String(h ?? '').trim());
    const rows      = data.slice(1);
    const groupIdx  = headers.findIndex((h: string) => h === 'Group');
    const regionIdx = headers.findIndex((h: string) => h === 'Region');
    const tickerIdx = headers.findIndex((h: string) => h === 'Ticker');

    if (tickerIdx === -1) return NextResponse.json({ error: 'Ticker 컬럼 없음' }, { status: 400 });

    const rawItems = rows
      .map((r: any[]) => ({
        group:  groupIdx  !== -1 ? String(r[groupIdx]  ?? '').trim() : '',
        region: regionIdx !== -1 ? String(r[regionIdx] ?? '').trim() : '',
        ticker: String(r[tickerIdx] ?? '').trim().toUpperCase(),
      }))
      .filter((it: any) => it.ticker);

    if (rawItems.length === 0) return NextResponse.json({ items: [] });

    // 시세 + 52주 고저 병렬 조회
    const [infoResults, hlResults] = await Promise.all([
      Promise.all(rawItems.map((it: any) => getStockInfo(it.ticker).catch(() => null))),
      Promise.all(rawItems.map((it: any) => get52WeekHighLow(it.ticker).catch(() => ({ high: 0, low: 0 })))),
    ]);

    const items = rawItems.map((it: any, i: number) => {
      const info = infoResults[i];
      const hl   = hlResults[i];
      return {
        group:      it.group,
        region:     it.region,
        ticker:     it.ticker,
        name:       (info?.name) || it.ticker,
        price:      info?.price      || 0,
        change:     info?.change     || 0,
        changePct:  info?.changepct  || 0,
        currency:   info?.currency   || (it.region === 'USA' ? 'USD' : 'KRW'),
        weekHigh52: hl?.high || 0,
        weekLow52:  hl?.low  || 0,
      };
    });

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
