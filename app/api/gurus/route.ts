import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

const GURU_CIKS: Record<string, string> = {
  'ray-dalio': '0001350694',
  'howard-marks': '0000949509'
};

async function fetchFilings(cik: string) {
  const res = await fetch(`https://13f.info/manager/${cik}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) throw new Error(`Failed to fetch manager page: ${res.status}`);
  
  const html = await res.text();
  const $ = cheerio.load(html);
  
  const filings: { qtr: string, filingId: string }[] = [];
  $('#managerFilings tbody tr').each((i, el) => {
     const tds = $(el).find('td');
     const formType = tds.eq(4).text().trim();
     if (formType === '13F-HR') {
        const qtr = tds.eq(0).text().trim();
        const filingId = tds.eq(6).text().trim();
        filings.push({ qtr, filingId });
     }
  });
  return filings;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const guru = searchParams.get('guru'); 
  const page = searchParams.get('page') || '1';

  if (!guru || !GURU_CIKS[guru]) {
    return NextResponse.json({ error: 'guru parameter is invalid' }, { status: 400 });
  }

  if (page && page !== '1') {
    return NextResponse.json({ guru, page, aum: '', latestQuarter: '', holdings: [], debugHtmlLength: 0 });
  }

  try {
    const cik = GURU_CIKS[guru];
    const filings = await fetchFilings(cik);
    
    if (filings.length < 2) {
      return NextResponse.json({ error: 'Not enough filings found' }, { status: 500 });
    }

    const curId = filings[0].filingId;
    const prevId = filings[1].filingId;
    const latestQuarter = filings[0].qtr;
    
    const curRes = await fetch(`https://13f.info/data/13f/${curId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!curRes.ok) throw new Error(`Failed to fetch current filing data: ${curRes.status}`);
    const curData = await curRes.json();
    
    const prevRes = await fetch(`https://13f.info/data/13f/${prevId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!prevRes.ok) throw new Error(`Failed to fetch prev filing data: ${prevRes.status}`);
    const prevData = await prevRes.json();
    
    const prevMap = new Map();
    if (prevData && prevData.data) {
        prevData.data.forEach((row: any) => {
           const cusip = row[3];
           const valueThousand = row[4] || 0;
           const shares = row[6] || 0;
           prevMap.set(cusip, { shares, valueThousand });
        });
    }
    
    let totalAum = 0;
    const holdings: any[] = [];
    
    if (curData && curData.data) {
        curData.data.forEach((row: any) => {
           let ticker = (row[0] || '').trim();
           if (!ticker) ticker = (row[3] || '').trim(); // Fallback to CUSIP
           
           const name = (row[1] || '').trim();
           const cusip = (row[3] || '').trim();
           const valueThousand = row[4] || 0;
           const currentShares = row[6] || 0;
           
           totalAum += valueThousand;
           
           let changeShares = 0;
           const prevDataRow = prevMap.get(cusip);
           if (prevDataRow) {
               changeShares = currentShares - prevDataRow.shares;
           } else {
               changeShares = currentShares;
           }
           
           let changeValueThousand = 0;
           if (currentShares > 0) {
               changeValueThousand = (changeShares / currentShares) * valueThousand;
           }
           
           let changeRawText = '';
           if (changeShares > 0) changeRawText = '+';
           else if (changeShares < 0) changeRawText = '-';
           
           let valStr = '';
           if (valueThousand > 1000000) valStr = '$' + (valueThousand/1000000).toFixed(2) + 'B';
           else valStr = '$' + (valueThousand/1000).toFixed(1) + 'M';
           
           holdings.push({
               cusip,
               ticker, 
               name, 
               valueThousand, 
               changeShares, 
               changeValueThousand, 
               changeRawText, 
               valStr
           });
        });
    }

    // Handled sold out positions
    if (prevData && prevData.data) {
        prevData.data.forEach((row: any) => {
            const cusip = (row[3] || '').trim();
            if (!holdings.find(h => h.cusip === cusip)) {
                let ticker = (row[0] || '').trim();
                if (!ticker) ticker = cusip;
                const name = (row[1] || '').trim();
                const prevValueThousand = row[4] || 0;
                const prevShares = row[6] || 0;
                
                holdings.push({
                    cusip,
                    ticker,
                    name,
                    valueThousand: 0,
                    changeShares: -prevShares,
                    changeValueThousand: -prevValueThousand,
                    changeRawText: '-',
                    valStr: '$0.0M'
                });
            }
        });
    }
    
    // Calculate weights
    holdings.forEach(h => {
       h.weightPct = totalAum > 0 ? ((h.valueThousand / totalAum)*100).toFixed(2) : '0.00';
       h.changeWeightPct = totalAum > 0 ? ((Math.abs(h.changeValueThousand) / totalAum)*100).toFixed(2) : '0.00';
       
       if (h.changeRawText === '+') h.change = '+' + h.changeWeightPct + '%';
       else if (h.changeRawText === '-') h.change = '-' + h.changeWeightPct + '%';
       else h.change = '';
    });
    
    // Remove cusip to save payload size
    holdings.forEach(h => delete h.cusip);
    
    // Sort by descending weight
    holdings.sort((a, b) => b.valueThousand - a.valueThousand);

    let aum = '';
    if (totalAum > 0) {
        if (totalAum > 1000000) aum = `$${(totalAum / 1000000).toFixed(2)}B`;
        else aum = `$${(totalAum / 1000).toFixed(1)}M`;
    }

    return NextResponse.json({ guru, page, aum, latestQuarter, holdings, debugHtmlLength: totalAum });
  } catch (error: any) {
    console.error('Guru fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
