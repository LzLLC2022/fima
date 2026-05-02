import { NextRequest, NextResponse } from 'next/server';
import { getSheetValues } from '@/lib/sheets';
import { getOwnerSheetId } from '@/lib/config';

const REBALANCING_SHEET_NAME = 'Rebalancing';

/**
 * POST /api/rebalancing
 * Body: { owner, region? }
 * Returns: { items: Array<{ region, ticker, name, divCycle, divCount, targetPct }> }
 *
 * Rebalancing 시트 구조 (헤더 행):
 *   Region | Ticker | Name | 연배당주기 | 연배당횟수 | 구성비중(%)
 */
export async function POST(req: NextRequest) {
  try {
    const { owner, region } = await req.json().catch(() => ({}));
    if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 });

    const spreadsheetId = getOwnerSheetId(owner);
    const data = await getSheetValues(spreadsheetId, REBALANCING_SHEET_NAME);

    if (!data || data.length < 2) return NextResponse.json({ items: [] });

    const headers = data[0].map((h: any) => String(h ?? '').trim());
    const rows    = data.slice(1);

    const ci = (name: string) => headers.findIndex((h: string) => h === name);
    const regionIdx = ci('Region');
    const tickerIdx = ci('Ticker');
    const nameIdx   = ci('Name');
    const freqIdx   = ci('연배당주기');
    const cntIdx    = ci('연배당횟수');
    const wgtIdx    = ci('구성비중(%)');

    const items = rows
      .filter((r: any[]) => {
        const tk = tickerIdx !== -1 ? String(r[tickerIdx] ?? '').trim() : '';
        if (!tk) return false;
        if (region) {
          const rg = regionIdx !== -1 ? String(r[regionIdx] ?? '').trim() : '';
          if (rg !== region) return false;
        }
        return true;
      })
      .map((r: any[]) => {
        // UNFORMATTED_VALUE: 20% 셀 → 0.2, 텍스트 "20.00%" → "20.00%"
        const rawW = wgtIdx !== -1 ? r[wgtIdx] : 0;
        let numW: number;
        if (typeof rawW === 'number') {
          numW = rawW <= 1 ? rawW * 100 : rawW;
        } else {
          const parsed = parseFloat(String(rawW).replace('%', '').trim()) || 0;
          numW = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
        }

        return {
          region:   regionIdx !== -1 ? String(r[regionIdx] ?? '').trim() : '',
          ticker:   tickerIdx !== -1 ? String(r[tickerIdx] ?? '').trim() : '',
          name:     nameIdx   !== -1 ? String(r[nameIdx]   ?? '').trim() : '',
          divCycle: freqIdx   !== -1 ? String(r[freqIdx]   ?? '').trim() : '',
          divCount: cntIdx    !== -1 ? (Number(r[cntIdx]   ?? 0) || 0)  : 0,
          targetPct: Math.round(numW * 100) / 100,  // 소수 2자리
        };
      });

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
