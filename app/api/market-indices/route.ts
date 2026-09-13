import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get('tickers');

  if (!tickersParam) {
    return NextResponse.json({ error: 'tickers parameter is required' }, { status: 400 });
  }

  const tickers = tickersParam.split(',').map(t => t.trim()).filter(Boolean);
  const results: Record<string, any> = {};

  const fetchChart = async (ticker: string) => {
    try {
      // Use 1y range with 1d interval for daily data over 1 year
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com/'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('No result');

      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];
      
      const price = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose || meta.previousClose;
      
      let change = 0;
      let changePercent = 0;
      if (price !== undefined && previousClose !== undefined && previousClose !== 0) {
        change = price - previousClose;
        changePercent = (change / previousClose) * 100;
      }

      // Filter out nulls from the close prices array
      const closes = (quote?.close || []).filter((c: number | null) => c !== null);

      return {
        price,
        change,
        changePercent,
        chart: closes
      };
    } catch (e: any) {
      console.error(`Error fetching index ${ticker}:`, e.message);
      return null;
    }
  };

  await Promise.all(
    tickers.map(async (ticker) => {
      const data = await fetchChart(ticker);
      if (data) {
        results[ticker] = data;
      }
    })
  );

  return NextResponse.json(results);
}
