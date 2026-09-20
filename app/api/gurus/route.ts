import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import https from 'https';

export const dynamic = 'force-dynamic';

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch holdingschannel: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

const GURU_URLS: Record<string, string> = {
  'ray-dalio': 'https://www.holdingschannel.com/13f/bridgewater-associates-lp-top-holdings/',
  'howard-marks': 'https://www.holdingschannel.com/13f/oaktree-capital-management-lp-top-holdings/'
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const guru = searchParams.get('guru'); 
  const page = searchParams.get('page') || '1';

  if (!guru || !GURU_URLS[guru]) {
    return NextResponse.json({ error: 'guru parameter is invalid' }, { status: 400 });
  }

  // HoldingsChannel doesn't have simple pagination for top holdings, it shows top 100 or so on one page.
  // So if page > 1, we just return empty so UI pagination stops.
  if (page && page !== '1') {
    return NextResponse.json({ guru, page, aum: '', latestQuarter: '', holdings: [], debugHtmlLength: 0 });
  }

  try {
    const url = GURU_URLS[guru];
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const holdings: any[] = [];
    let latestQuarter = '';
    let currentName = '';
    let totalAum = 0;

    // First pass: extract all holdings and sum AUM
    $('table#hldtable tr').each((i, el) => {
      const isMain = $(el).find('td.mainrow').length > 0;
      const isArow = $(el).find('td.arow').length > 0;

      if (isMain) {
        currentName = $(el).find('td').eq(0).text().replace(/\s+/g, ' ').trim();
      } else if (isArow) {
        const tds = $(el).find('td');
        const securityType = tds.eq(0).text().replace(/\s+/g, ' ').trim();
        const sharesRaw = tds.eq(1).text().replace(/[^0-9]/g, '');
        const changeRawText = tds.eq(2).text().replace(/\s+/g, ' ').trim();
        const changeRawNum = tds.eq(2).text().replace(/[^0-9-]/g, '');
        const valueRaw = tds.eq(3).text().replace(/[^0-9]/g, '');

        let parsedName = currentName;
        let parsedTicker = securityType;
        const tickerMatch = currentName.match(/(.+?)\s+\(([A-Z]+)\)$/);
        if (tickerMatch) {
          parsedName = tickerMatch[1].trim();
          parsedTicker = tickerMatch[2].trim();
        }

        const shares = parseInt(sharesRaw) || 0;
        let changeShares = parseInt(changeRawNum) || 0;
        if (changeRawText.includes('+')) changeShares = Math.abs(changeShares);
        else if (changeRawText.includes('-')) changeShares = -Math.abs(changeShares);

        const valueThousand = parseInt(valueRaw) || 0;
        totalAum += valueThousand;

        // format value
        let valStr = valueRaw;
        if (valueThousand > 1000000) valStr = `$${(valueThousand / 1000000).toFixed(2)}B`;
        else valStr = `$${(valueThousand / 1000).toFixed(1)}M`;

        // Calculate value of the changed shares
        let changeValueThousand = 0;
        if (shares > 0) {
           changeValueThousand = (changeShares / shares) * valueThousand;
        }

        holdings.push({
          ticker: parsedTicker,
          name: parsedName,
          valueStr: valStr,
          valueThousand: valueThousand,
          changeRawText: changeRawText,
          changeValueThousand: changeValueThousand
        });
      }
    });

    // Second pass: calculate weights
    holdings.forEach(h => {
       h.weightPct = totalAum > 0 ? ((h.valueThousand / totalAum) * 100).toFixed(2) : '0.00';
       h.changeWeightPct = totalAum > 0 ? ((Math.abs(h.changeValueThousand) / totalAum) * 100).toFixed(2) : '0.00';
       
       // Format change string for UI
       if (h.changeRawText.includes('+')) {
         h.change = `+${h.changeWeightPct}%`;
       } else if (h.changeRawText.includes('-')) {
         h.change = `-${h.changeWeightPct}%`;
       } else {
         h.change = '';
       }
    });

    let aum = '';
    if (totalAum > 0) {
        if (totalAum > 1000000) aum = `$${(totalAum / 1000000).toFixed(2)}B`;
        else aum = `$${(totalAum / 1000).toFixed(1)}M`;
    }

    return NextResponse.json({ guru, page, aum, latestQuarter, holdings, debugHtmlLength: html.length });
  } catch (error: any) {
    console.error('Guru fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
