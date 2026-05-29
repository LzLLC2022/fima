/**
 * Ledger 시트에서 현재 보유 중인 종목 목록을 가볍게 추출.
 * 시세·환율 조회는 하지 않음 — ticker / name / region / 현재 보유수량만 반환.
 *
 * portfolio API ([app/api/portfolio/route.ts]) 의 누적 로직을 그대로 따름:
 *   - buy / div-stock      : buyQty += qty
 *   - sell                 : sellQty += qty
 *   - split                : splitAdj += qty
 *   - merge / reverse-split: splitAdj -= qty
 *   - netQty = (buyQty + splitAdj) - sellQty
 *   - netQty > 0.0001 인 ticker만 보유 종목으로 간주
 */

import { getSheetValues, LEDGER_SHEET_NAME } from '@/lib/sheets';

export interface OwnedPosition {
  ticker:   string;
  name:     string;
  region:   string;
  quantity: number;
}

export async function getOwnedPositions(sheetId: string): Promise<OwnedPosition[]> {
  let data: any[][];
  try {
    data = await getSheetValues(sheetId, LEDGER_SHEET_NAME);
  } catch {
    return [];
  }
  if (!data || data.length < 2) return [];

  const headers   = data[0].map((h: any) => String(h ?? '').trim());
  const tickerIdx = headers.indexOf('Ticker');
  const tradeIdx  = headers.indexOf('Trade');
  const qtyIdx    = headers.indexOf('Quantity');
  const nameIdx   = headers.indexOf('Name');
  const regionIdx = headers.indexOf('Region');
  const assetIdx  = headers.indexOf('Asset Type');
  if (tickerIdx === -1 || qtyIdx === -1 || tradeIdx === -1) return [];

  interface Acc { buyQty: number; sellQty: number; splitAdj: number; name: string; region: string; }
  const map = new Map<string, Acc>();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ticker = String(row[tickerIdx] ?? '').trim().toUpperCase();
    if (!ticker) continue;
    // Cash 행 제외
    if (assetIdx !== -1 && String(row[assetIdx] ?? '').trim().toLowerCase() === 'cash') continue;

    const t   = String(row[tradeIdx] ?? '').trim().toLowerCase().replace(/[-\s]/g, '');
    const qty = Number(String(row[qtyIdx] ?? '').replace(/,/g, '')) || 0;
    const isDiv     = t.startsWith('div');
    const isDivStk  = isDiv && t.includes('stock');
    if (!(t === 'buy' || t === 'sell' || t === 'split' || t === 'merge' || t === 'reversesplit' || isDivStk)) continue;

    let acc = map.get(ticker);
    if (!acc) {
      acc = { buyQty: 0, sellQty: 0, splitAdj: 0, name: '', region: '' };
      map.set(ticker, acc);
    }
    // 최신 행의 name/region 사용 (행 순서 = 입력 순서)
    const nm = nameIdx   !== -1 ? String(row[nameIdx]   ?? '').trim() : '';
    const rg = regionIdx !== -1 ? String(row[regionIdx] ?? '').trim() : '';
    if (nm) acc.name   = nm;
    if (rg) acc.region = rg;

    if (t === 'buy' || isDivStk)       acc.buyQty   += qty;
    else if (t === 'sell')             acc.sellQty  += qty;
    else if (t === 'split')            acc.splitAdj += qty;
    else if (t === 'merge' || t === 'reversesplit') acc.splitAdj -= qty;
  }

  const result: OwnedPosition[] = [];
  map.forEach((acc, ticker) => {
    const netQty = (acc.buyQty + acc.splitAdj) - acc.sellQty;
    if (netQty > 0.0001) {
      result.push({ ticker, name: acc.name || ticker, region: acc.region, quantity: netQty });
    }
  });
  return result;
}
