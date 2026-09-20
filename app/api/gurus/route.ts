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

    // Try to get latest quarter from h1 or table header
    const thText = $('table#hldtable th').text();
    const qMatch = thText.match(/to\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})/);
    if (qMatch) {
      latestQuarter = qMatch[1]; // e.g. "06/30/2026"
    }

    $('table#hldtable tr').each((i, el) => {
      const isMain = $(el).find('td.mainrow').length > 0;
      const isArow = $(el).find('td.arow').length > 0;

      if (isMain) {
        currentName = $(el).find('td').eq(0).text().replace(/\s+/g, ' ').trim();
      } else if (isArow) {
        const tds = $(el).find('td');
        const ticker = tds.eq(0).text().replace(/\s+/g, ' ').trim();
        const changeRaw = tds.eq(2).text().replace(/\s+/g, ' ').trim();
        const valueRaw = tds.eq(3).text().replace(/\s+/g, ' ').trim();

        // format value from "$2,248,382" (which is in 1000s) to "$2.2B" or "$2,248M"
        let valStr = valueRaw;
        const numVal = parseInt(valueRaw.replace(/[^0-9]/g, ''));
        if (!isNaN(numVal)) {
          if (numVal > 1000000) {
            valStr = `$${(numVal / 1000000).toFixed(2)}B`;
          } else {
            valStr = `$${(numVal / 1000).toFixed(1)}M`;
          }
        }

        holdings.push({
          ticker: ticker,
          name: currentName,
          portfolioPct: valStr, // Abuse portfolioPct to show value
          change: changeRaw
        });
      }
    });

    let aum = '';
    // AUM can be estimated by summing all valueRaw in 1000s
    let totalAum = 0;
    $('table#hldtable tr td.arow').each((i, el) => {
        const tds = $(el).find('td');
        const valueRaw = tds.eq(3).text().replace(/\s+/g, ' ').trim();
        const numVal = parseInt(valueRaw.replace(/[^0-9]/g, ''));
        if (!isNaN(numVal)) totalAum += numVal;
    });

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
