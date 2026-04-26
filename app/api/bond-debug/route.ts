import { NextRequest, NextResponse } from 'next/server';

async function tryFetch(label: string, url: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, { ...init });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 600); }
    return { label, status: res.status, body };
  } catch (e: any) {
    return { label, error: e.message };
  }
}

// GET /api/bond-debug?isin=KR2032521043
export async function GET(req: NextRequest) {
  const isin = (req.nextUrl.searchParams.get('isin') || 'KR2032521043').toUpperCase();
  const ua   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  const calls = await Promise.all([
    // KRX 채권 이름 검색 (POST)
    tryFetch('krx_bond', 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua, 'Referer': 'https://data.krx.co.kr' },
      body: `bld=dbms%2FMDC%2FSTAT%2Fstandard%2FMDCSTAT09901&isuCd=${isin}&strtDd=20250101&endDd=20260426`,
    }),

    // KRX ISIN 검색 (POST)
    tryFetch('krx_isin', 'https://isin.krx.co.kr/srh/srh0101IsinSrch.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua, 'Referer': 'https://isin.krx.co.kr' },
      body: `isinCd=${isin}&kind=B`,
    }),

    // KRX ISIN JSON API
    tryFetch('krx_isin_json', `https://isin.krx.co.kr/srh/srh0101IsinSrch.do?isinCd=${isin}&kind=B`, {
      headers: { 'Accept': 'application/json', 'User-Agent': ua, 'Referer': 'https://isin.krx.co.kr' },
    }),

    // KOFIA 채권 기본정보
    tryFetch('kofia', `https://www.kofiabond.or.kr/service/bondBasicInfo.do?standardCd=${isin}`, {
      headers: { 'User-Agent': ua, 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://www.kofiabond.or.kr' },
    }),

    // KOFIA 장외채권 정보시스템
    tryFetch('kofiabond', `https://www.kofiabond.or.kr/bnd/svc/bndMst/getBndMstListByISIN.do?isin=${isin}`, {
      headers: { 'User-Agent': ua, 'Accept': 'application/json', 'Referer': 'https://www.kofiabond.or.kr' },
    }),

    // 금투협 채권 가격 API
    tryFetch('kfia_price', `https://www.kofiabond.or.kr/bnd/svc/bondprice/getClosePriceListByISIN.do?isin=${isin}`, {
      headers: { 'User-Agent': ua, 'Accept': 'application/json', 'Referer': 'https://www.kofiabond.or.kr' },
    }),
  ]);

  const out: Record<string, any> = {};
  calls.forEach(r => { out[r.label] = r; });
  return NextResponse.json({ isin, results: out });
}
