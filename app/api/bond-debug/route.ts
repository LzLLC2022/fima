import { NextRequest, NextResponse } from 'next/server';

async function tryFetch(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();          // body를 한 번만 읽음
    let body: any;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 800); }
    return { status: res.status, body };
  } catch (e: any) {
    return { error: e.message };
  }
}

// GET /api/bond-debug?isin=KR2032521043
export async function GET(req: NextRequest) {
  const isin  = (req.nextUrl.searchParams.get('isin') || 'KR2032521043').toUpperCase();
  const ua    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const uaMob = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)';

  const results = await Promise.all([
    // 1. Naver polling (채권)
    tryFetch(`https://polling.finance.naver.com/api/realtime/domestic/bond/${isin}`,
      { 'User-Agent': ua, 'Referer': 'https://finance.naver.com', 'Accept': 'application/json' }),

    // 2. Naver mobile bond basic
    tryFetch(`https://m.stock.naver.com/api/bond/${isin}/basic`,
      { 'User-Agent': uaMob, 'Referer': 'https://m.stock.naver.com', 'Accept': 'application/json' }),

    // 3. Naver sise bondItemTotal
    tryFetch(`https://finance.naver.com/api/sise/bondItemTotal.nhn?reutersCode=${isin}`,
      { 'User-Agent': ua, 'Referer': 'https://finance.naver.com/bond/', 'Accept': 'application/json' }),

    // 4. KSD ISIN 검색 (한국예탁결제원)
    tryFetch(`https://isin.krx.co.kr/srh/srh0101IsinSrch.do`,
      { 'User-Agent': ua, 'Referer': 'https://isin.krx.co.kr', 'Content-Type': 'application/x-www-form-urlencoded' }),

    // 5. Naver mobile bond detail
    tryFetch(`https://m.stock.naver.com/api/bond/${isin}/detail`,
      { 'User-Agent': uaMob, 'Referer': 'https://m.stock.naver.com', 'Accept': 'application/json' }),

    // 6. Naver finance bond detail page (HTML)
    tryFetch(`https://finance.naver.com/bond/detailData.nhn?codeType=2&code=${isin}`,
      { 'User-Agent': ua, 'Referer': 'https://finance.naver.com/bond/' }),
  ]);

  const keys = ['polling', 'mobile_basic', 'sise', 'ksd', 'mobile_detail', 'naver_detail'];
  const out: Record<string, any> = {};
  keys.forEach((k, i) => { out[k] = results[i]; });

  return NextResponse.json({ isin, results: out });
}
