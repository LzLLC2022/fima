const https = require('https');
const API_KEY = '855d3247d6ed96927f6333dc65fb8b43f650a88cf8bf66e2e293a4f88bbf79a2';
const url = `https://apis.data.go.kr/B552481/StockSvc/getDividendRankN1?serviceKey=${API_KEY}&year=2025&numOfRows=10&pageNo=1`;
https.get(url, res => { let d=''; res.on('data', c=>d+=c); res.on('end', ()=>console.log('RES:', d)); });
