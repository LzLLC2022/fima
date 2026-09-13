const fetchChart = async (ticker) => { 
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`; 
  const r = await fetch(url); 
  const j = await r.json(); 
  console.log(ticker, JSON.stringify(j.chart.result[0].meta)); 
}; 
Promise.all(['^TNX','CL=F'].map(fetchChart));
