import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const guru = searchParams.get('guru'); // e.g., 'ray-dalio', 'howard-marks'

  if (!guru) {
    return NextResponse.json({ error: 'guru parameter is required' }, { status: 400 });
  }

  try {
    const url = `https://stockcircle.com/portfolio/${guru}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      },
      next: { revalidate: 3600 * 24 } // 24 hours cache
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch stockcircle: ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const holdings: any[] = [];
    $('.share__top-box').each((i, el) => {
      if (i >= 10) return; // Top 10 only

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

    return NextResponse.json({ guru, holdings });
  } catch (error: any) {
    console.error('Guru fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
