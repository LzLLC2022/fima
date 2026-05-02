import { NextRequest, NextResponse } from 'next/server';

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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yticker)}?${params}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No result');
  return result;
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
    const candidates = isKoreanCode(clean)
      ? [`${clean.split('.')[0]}.KS`, `${clean.split('.')[0]}.KQ`]
      : [clean];

    let chartResult: any = null;
    let usedTicker = '';
    for (const yt of candidates) {
      try {
        // 2년치 일봉 + 배당 이벤트
        chartResult = await fetchChart(yt, 'interval=1d&range=2y&events=dividends');
        usedTicker = yt;
        break;
      } catch { /* try next */ }
    }
    if (!chartResult) return NextResponse.json({ error: '데이터를 가져올 수 없습니다' }, { status: 404 });

    const [summary] = await Promise.all([fetchSummary(usedTicker)]);

    const meta       = chartResult.meta;
    const timestamps: number[]          = chartResult.timestamp || [];
    const q          = chartResult.indicators?.quote?.[0] || {};
    const closes: (number|null)[]  = q.close  || [];
    const highs:  (number|null)[]  = q.high   || [];
    const lows:   (number|null)[]  = q.low    || [];

    // 기본 정보
    // regularMarketPreviousClose = 실제 전일 종가
    // chartPreviousClose = 차트 range 시작 시점의 종가 (2y 요청 시 2년 전 종가 → 오류)
    const price     = meta.regularMarketPrice ?? 0;
    const prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change    = Math.round((price - prevClose) * 10000) / 10000;
    const changePct = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;

    // 날짜 범위
    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;

    const ytd = buildPeriodData(timestamps, closes, highs, lows, ytdStart);
    const mtd = buildPeriodData(timestamps, closes, highs, lows, mtdStart);

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
      name:      meta.longName || meta.shortName || clean,
      currency:  meta.currency || 'USD',
      price,
      change,
      changePct,
      volume:    meta.regularMarketVolume ?? 0,
      high52:    meta.fiftyTwoWeekHigh ?? 0,
      low52:     meta.fiftyTwoWeekLow  ?? 0,
      ytd,
      mtd,
      dividend:  { fwdAmount, fwdYield, ttmAmount, ttmYield, history },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
