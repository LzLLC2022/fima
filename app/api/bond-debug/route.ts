import { NextRequest, NextResponse } from 'next/server';

// GET /api/bond-debug?isin=KR2032521043
// Naver 채권 API 응답 원문을 그대로 반환 — 필드명 확인용
export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get('isin') || 'KR2032521043';
  const upper = isin.toUpperCase();
  const results: Record<string, any> = {};

  // 시도 1: polling API
  try {
    const url = `https://polling.finance.naver.com/api/realtime/domestic/bond/${upper}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer':    'https://finance.naver.com',
        'Accept':     'application/json',
      },
    });
    results.polling = { status: res.status, body: await res.json().catch(() => res.text()) };
  } catch (e: any) {
    results.polling = { error: e.message };
  }

  // 시도 2: 모바일 API
  try {
    const url = `https://m.stock.naver.com/api/bond/${upper}/basic`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Referer':    'https://m.stock.naver.com',
        'Accept':     'application/json',
      },
    });
    results.mobile = { status: res.status, body: await res.json().catch(() => res.text()) };
  } catch (e: any) {
    results.mobile = { error: e.message };
  }

  // 시도 3: sise API
  try {
    const url = `https://finance.naver.com/api/sise/bondItemTotal.nhn?reutersCode=${upper}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer':    'https://finance.naver.com/bond/',
        'Accept':     'application/json',
      },
    });
    results.sise = { status: res.status, body: await res.json().catch(() => res.text()) };
  } catch (e: any) {
    results.sise = { error: e.message };
  }

  // 시도 4: 네이버 채권 검색 API
  try {
    const url = `https://finance.naver.com/bond/search.nhn?query=${upper}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer':    'https://finance.naver.com/bond/',
      },
    });
    const text = await res.text();
    results.search = { status: res.status, body: text.slice(0, 1000) };
  } catch (e: any) {
    results.search = { error: e.message };
  }

  return NextResponse.json({ isin: upper, results });
}
