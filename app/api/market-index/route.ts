import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });

  const end = Math.floor(Date.now() / 1000) + 86400;
  const start = end - 365 * 86400; // 52 weeks
  const encoded = encodeURIComponent(ticker);

  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&period1=${start}&period2=${end}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
      });
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp || [];
      const closes: number[] =
        result.indicators?.quote?.[0]?.close ||
        result.indicators?.adjclose?.[0]?.adjclose || [];

      const data = timestamps
        .map((ts, i) => {
          const d = new Date(ts * 1000);
          const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          return { date, close: closes[i] };
        })
        .filter(d => d.close != null);

      if (data.length === 0) continue;

      const multiplier = ticker === 'JPYKRW=X' ? 100 : 1;

      const meta = result.meta;
      const currentPrice = (meta.regularMarketPrice || data[data.length - 1].close) * multiplier;
      const previousClose = (data.length > 1 ? data[data.length - 2].close : currentPrice) * multiplier;
      const change = currentPrice - previousClose;
      const changePercent = (change / previousClose) * 100;
      
      let high52 = -Infinity;
      let low52 = Infinity;
      data.forEach(d => {
        d.close = d.close * multiplier;
        if (d.close > high52) high52 = d.close;
        if (d.close < low52) low52 = d.close;
      });

      return NextResponse.json({
        ticker,
        currentPrice,
        previousClose,
        change,
        changePercent,
        high52,
        low52,
        data
      });
    } catch (e) {
      console.error(e);
    }
  }
  return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
}
