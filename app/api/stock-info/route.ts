import { NextRequest, NextResponse } from 'next/server';
import { getStockInfo } from '@/lib/stock';

function isKoreanCode(code: string): boolean {
  const c = code.toString().trim().toUpperCase().split('.')[0];
  if (c.length === 12 && c.startsWith('KR')) return false;
  return /^[0-9A-Z]{6}$/.test(c) && /\d/.test(c);
}

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

async function fetchChart(yticker: string, params: string) {
  const encoded = encodeURIComponent(yticker);
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?${params}`;
      const res = await fetch(url, { headers: YAHOO_HEADERS });
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (result) return result;
    } catch { /* try next host */ }
  }
  throw new Error('No result');
}

async function fetchSummary(yticker: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yticker)}?modules=summaryDetail`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.quoteSummary?.result?.[0]?.summaryDetail ?? null;
  } catch { return null; }
}

async function fetchNaverChartData(code: string): Promise<{
  timestamps: number[];
  closes: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
} | null> {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toNaverDate = (d: Date) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

  const endDt   = new Date();
  const startDt = new Date(endDt.getTime() - 2 * 365 * 86400 * 1000);

  const url = `https://api.finance.naver.com/siseJson.naver`
    + `?symbol=${code}&requestType=1`
    + `&startTime=${toNaverDate(startDt)}&endTime=${toNaverDate(endDt)}`
    + `&timeframe=day`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://finance.naver.com',
      },
    });
    if (!res.ok) return null;

    const text = (await res.text()).trim().replace(/^﻿/, '');
    let rows: any[][];
    try { rows = JSON.parse(text); }
    catch { rows = JSON.parse(text.replace(/'/g, '"')); }

    // 유효 데이터 행만 필터 (헤더 제외): [날짜, 시가, 고가, 저가, 종가, 거래량]
    const dataRows = rows.filter(
      (r: any[]) => Array.isArray(r) && r.length >= 5 && !isNaN(Number(r[4])) && Number(r[4]) > 0
    );
    if (!dataRows.length) return null;

    const timestamps: number[] = [];
    const closes: (number | null)[] = [];
    const highs: (number | null)[]  = [];
    const lows: (number | null)[]   = [];

    for (const r of dataRows) {
      const dateStr = String(r[0]);
      const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), d2 = dateStr.slice(6, 8);
      const ts = new Date(`${y}-${m}-${d2}T00:00:00+09:00`).getTime() / 1000;
      timestamps.push(ts);
      highs.push(Number(r[2]) || null);
      lows.push(Number(r[3]) || null);
      closes.push(Number(r[4]) || null);
    }

    return { timestamps, closes, highs, lows };
  } catch {
    return null;
  }
}

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildPeriodData(
  timestamps: number[],
  closes: (number | null)[],
  highs: (number | null)[],
  lows: (number | null)[],
  startTs: number,
) {
  const indices: number[] = [];
  timestamps.forEach((t, i) => {
    if (t >= startTs && closes[i] != null) indices.push(i);
  });
  if (indices.length === 0) return { high: 0, low: 0, dates: [] as string[], prices: [] as number[], change: 0, changePct: 0 };

  const prices  = indices.map(i => closes[i] as number);
  const allHighs = indices.map(i => highs[i]).filter((v): v is number => v != null);
  const allLows  = indices.map(i => lows[i]).filter((v): v is number => v != null);
  const high = allHighs.length ? Math.max(...allHighs) : 0;
  const low  = allLows.length  ? Math.min(...allLows)  : 0;

  const dates = indices.map(i => {
    const d = new Date(timestamps[i] * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const first  = prices[0];
  const last   = prices[prices.length - 1];
  const change    = Math.round((last - first) * 10000) / 10000;
  const changePct = first > 0 ? Math.round((change / first) * 10000) / 100 : 0;

  return { high, low, dates, prices, change, changePct };
}

export async function POST(req: NextRequest) {
  try {
    const { ticker } = await req.json().catch(() => ({}));
    if (!ticker) return NextResponse.json({ error: 'ticker 필요' }, { status: 400 });

    const clean = ticker.toString().trim().toUpperCase();
    const hasSuffix = /\.(KS|KQ)$/i.test(clean);
    const candidates = isKoreanCode(clean)
      ? hasSuffix ? [clean] : [`${clean}.KS`, `${clean}.KQ`]
      : [clean];

    // 한국 bare code: 네이버 가격 pre-fetch (Yahoo .KS가 다른 종목을 반환하는 경우 감지용)
    let naverInfo: any = null;
    if (isKoreanCode(clean) && !hasSuffix) {
      naverInfo = await getStockInfo(clean.split('.')[0]).catch(() => null);
    }

    let chartResult: any = null;
    let usedTicker = '';
    for (const yt of candidates) {
      try {
        // 2년치 일봉 + 배당 이벤트
        chartResult = await fetchChart(yt, 'interval=1d&range=2y&events=dividends');
        if (yt.endsWith('.KS') && candidates.length > 1) {
          // exchangeName=KOQ(코스닥) → .KQ 재시도
          const exch = chartResult?.meta?.exchangeName || '';
          if (exch === 'KOQ') { chartResult = null; continue; }
          // 네이버 가격과 10% 이상 차이 → 다른 종목으로 판단 → .KQ 재시도
          const yahooPrice = chartResult?.meta?.regularMarketPrice ?? 0;
          if (naverInfo?.price > 0 && yahooPrice > 0) {
            const diff = Math.abs(yahooPrice - naverInfo.price) / naverInfo.price;
            if (diff > 0.10) { chartResult = null; continue; }
          }
        }
        usedTicker = yt;
        break;
      } catch { /* try next */ }
    }
    // Yahoo Finance 실패 시 한국 종목은 네이버 siseJson으로 폴백
    let naverChartData: Awaited<ReturnType<typeof fetchNaverChartData>> = null;
    if (!chartResult && isKoreanCode(clean)) {
      naverChartData = await fetchNaverChartData(clean.split('.')[0]);
    }
    if (!chartResult && !naverChartData) {
      return NextResponse.json({ error: '데이터를 가져올 수 없습니다' }, { status: 404 });
    }

    // 네이버 폴백: 네이버 차트 데이터로 Yahoo 구조를 모방해 chartResult 구성
    if (!chartResult && naverChartData && naverInfo) {
      const { timestamps, closes, highs, lows } = naverChartData;
      const now       = Date.now();
      const w52Start  = now / 1000 - 365 * 24 * 3600;
      const ytdStart  = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
      const mtdStart  = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000;
      const ytd = buildPeriodData(timestamps, closes, highs, lows, ytdStart);
      const mtd = buildPeriodData(timestamps, closes, highs, lows, mtdStart);
      const w52 = buildPeriodData(timestamps, closes, highs, lows, w52Start);
      return NextResponse.json({
        ticker:     clean,
        origTicker: clean,
        name:       naverInfo.name || clean,
        currency:   'KRW',
        price:      naverInfo.price || 0,
        change:     naverInfo.change || 0,
        changePct:  (naverInfo.changepct ?? 0) * 100,
        volume:     naverInfo.volume || 0,
        high52:     w52.high,
        low52:      w52.low,
        ytd, mtd, w52,
        dividend: { fwdAmount: 0, fwdYield: 0, ttmAmount: 0, ttmYield: 0, history: [] },
      });
    }

    const [summary] = await Promise.all([fetchSummary(usedTicker)]);

    const meta       = chartResult.meta;
    const timestamps: number[]          = chartResult.timestamp || [];
    const q          = chartResult.indicators?.quote?.[0] || {};
    // adjclose 원소별 병합: q.close[i]가 null이면 adjclose[i]로 대체
    // (일부 한국 ETF는 최근 구간 q.close가 null이고 adjclose에만 종가가 있음)
    const adjCloses: (number|null)[] = chartResult.indicators?.adjclose?.[0]?.adjclose || [];
    const rawClose: (number|null)[]  = q.close || [];
    const closes: (number|null)[]    = rawClose.map((v, i) => v ?? adjCloses[i] ?? null);
    const highs:  (number|null)[]  = q.high   || [];
    const lows:   (number|null)[]  = q.low    || [];

    // 기본 정보
    // meta.regularMarketPreviousClose 는 일부 종목(ETN 등)에서 현재가와 동일하게 반환되는 경우가 있어 신뢰하지 않음
    // 일봉 차트 데이터의 마지막에서 두 번째 종가 = 전일 종가 (가장 신뢰성 높음)
    let price = meta.regularMarketPrice ?? 0;

    const validCloses = closes.filter((c): c is number => c != null);
    // 마지막 종가(오늘) / 마지막에서 두번째(전일)
    const prevCloseFromChart = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
    const prevClose = prevCloseFromChart ?? meta.regularMarketPreviousClose ?? meta.previousClose ?? price;
    let change    = Math.round((price - prevClose) * 10000) / 10000;
    let changePct = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
    let volume    = meta.regularMarketVolume ?? 0;
    let name      = meta.longName || meta.shortName || clean;
    let currency  = meta.currency || 'USD';

    // 한국 종목: 네이버 가격으로 override (코스피/코스닥 모두 정확)
    if (naverInfo?.price > 0) {
      price     = naverInfo.price;
      change    = naverInfo.change    ?? change;
      changePct = (naverInfo.changepct ?? 0) * 100;
      volume    = naverInfo.volume    ?? volume;
      if (naverInfo.name) name = naverInfo.name;
      currency  = naverInfo.currency  || 'KRW';
    }

    // 날짜 범위
    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    const w52Start = Date.now() / 1000 - 365 * 24 * 3600;

    const ytd = buildPeriodData(timestamps, closes, highs, lows, ytdStart);
    const mtd = buildPeriodData(timestamps, closes, highs, lows, mtdStart);
    const w52 = buildPeriodData(timestamps, closes, highs, lows, w52Start);

    // 배당 이벤트
    const divEvents = chartResult.events?.dividends ?? {};
    type DivItem = { amount: number; date: number };
    const divList: DivItem[] = Object.values(divEvents as Record<string, DivItem>)
      .sort((a, b) => b.date - a.date);

    // TTM
    const oneYearAgo = Date.now() / 1000 - 365 * 24 * 3600;
    const ttmDivs   = divList.filter(d => d.date >= oneYearAgo);
    const ttmAmount = Math.round(ttmDivs.reduce((s, d) => s + d.amount, 0) * 10000) / 10000;
    const ttmYield  = price > 0 ? Math.round(ttmAmount / price * 10000) / 100 : 0;

    // FWD (summaryDetail 우선, 없으면 최근 배당×연간빈도 추정)
    let fwdAmount = 0, fwdYield = 0;
    if (summary?.dividendRate?.raw != null) {
      fwdAmount = Math.round(summary.dividendRate.raw * 10000) / 10000;
      fwdYield  = summary.dividendYield?.raw != null
        ? Math.round(summary.dividendYield.raw * 10000) / 100
        : (price > 0 ? Math.round(fwdAmount / price * 10000) / 100 : 0);
    } else if (divList.length > 0) {
      const freq = Math.max(ttmDivs.length, 1);
      fwdAmount  = Math.round(divList[0].amount * freq * 10000) / 10000;
      fwdYield   = price > 0 ? Math.round(fwdAmount / price * 10000) / 100 : 0;
    }

    // 배당 히스토리 (1년 이내)
    const history = ttmDivs.map(d => ({
      exDate:  fmtDate(d.date),
      payDate: '-',
      amount:  Math.round(d.amount * 100000) / 100000,
    }));

    return NextResponse.json({
      ticker:    usedTicker,
      origTicker: clean,
      name,
      currency,
      price,
      change,
      changePct,
      volume,
      high52:    meta.fiftyTwoWeekHigh ?? 0,
      low52:     meta.fiftyTwoWeekLow  ?? 0,
      ytd,
      mtd,
      w52,
      dividend:  { fwdAmount, fwdYield, ttmAmount, ttmYield, history },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
