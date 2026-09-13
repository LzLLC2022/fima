const fetchChart = async (ticker) => { 
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`; 
  const r = await fetch(url); 
  const j = await r.json(); 
  
  const quote = j.chart.result[0].indicators.quote[0];
  const chart = quote.close.filter(c => c !== null);
  
  const min = Math.min(...chart);
  const max = Math.max(...chart);
  const range = max - min || 1;
  const width = 64;
  const height = 32;
  const paddingY = 4;
  const effHeight = height - paddingY * 2;
  
  const points = chart.map((val, i) => {
    const x = (i / (chart.length - 1)) * width;
    const y = height - paddingY - ((val - min) / range) * effHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  
  console.log(ticker, chart.slice(0, 5), min, max, points.length);
  // print the last 10 points
  const pointsArr = points.split(' ');
  console.log('last 10 points:', pointsArr.slice(-10).join(' '));
}; 
Promise.all(['^TNX','CL=F'].map(fetchChart));
