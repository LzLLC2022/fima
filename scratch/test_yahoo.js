const fetchChart = async (ticker) => { 
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`; 
  const r = await fetch(url); 
  const j = await r.json(); 
  console.log(ticker, r.status, j.chart?.result ? 'OK' : 'FAIL', j.chart?.result?.[0]?.meta?.regularMarketPrice, j.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.length); 
}; 
Promise.all(['^KS11','^TNX','CL=F'].map(fetchChart));
