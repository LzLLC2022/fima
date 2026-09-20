import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const guru = searchParams.get('guru'); 
  const page = searchParams.get('page') || '1';

  if (!guru) {
    return NextResponse.json({ error: 'guru parameter is required' }, { status: 400 });
  }

  try {
    let url = `https://stockcircle.com/portfolio/${guru}`;
    if (page && page !== '1') {
      url += `?page=${page}`;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      },
      cache: 'no-store' // Avoid caching empty responses
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch stockcircle: ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const holdings: any[] = [];
    $('.share__top-box').each((i, el) => {
      const aTag = $(el).find('a.share__company-link');
      if (!aTag.length) return;
      
      const href = aTag.attr('href') || '';
      const ticker = href.split('/').pop()?.toUpperCase() || '';
      const name = aTag.find('img').attr('alt') || '';
      const info = $(el).text().replace(/\s+/g, ' ').trim();

      // Extract details via regex
      const portfolioMatch = info.match(/% of Portfolio ([\d.]+)%/);
      const portfolioPct = portfolioMatch ? portfolioMatch[1] : '';

      const addedMatch = info.match(/Increased shares by ([\d.]+)%/);
      const soldMatch = info.match(/Sold ([\d.]+)% shares/);

      let change = '';
      if (addedMatch) change = `+${addedMatch[1]}%`;
      else if (soldMatch) change = `-${soldMatch[1]}%`;

      holdings.push({
        ticker,
        name,
        portfolioPct,
        change
      });
    });

    // We can also extract total AUM from the header if it's page 1
    let aum = '';
    if (page === '1') {
      const desc = $('meta[name="description"]').attr('content') || '';
      const aumMatch = desc.match(/portfolio value of ([\$\d\.BM]+)/);
      if (aumMatch) aum = aumMatch[1];
    }

    return NextResponse.json({ guru, page, aum, holdings });
  } catch (error: any) {
    console.error('Guru fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
