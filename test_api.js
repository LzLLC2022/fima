const https = require('https');
const API_KEY = 'n8Dzw4g4XvAFEyZfL4lqk82h0QtkJ5mIC6wtng1ISkTz3G9gqyuUpceFVhHGTKVxvO9oUX79Ou0b7X6%2F0JXRNQ%3D%3D';

const url1 = `https://apis.data.go.kr/B552481/StockSvc/getDividendRankN1?serviceKey=${API_KEY}&year=2026&numOfRows=10&pageNo=1`;
const url2 = `https://apis.data.go.kr/B552481/StockSvc/getDividendRankN1?serviceKey=${decodeURIComponent(API_KEY)}&year=2026&numOfRows=10&pageNo=1`;

console.log("Fetching URL1...");
https.get(url1, res => { 
  let d=''; res.on('data', c=>d+=c); 
  res.on('end', ()=>console.log('URL1:', d.substring(0,250))); 
});

console.log("Fetching URL2...");
https.get(url2, res => { 
  let d=''; res.on('data', c=>d+=c); 
  res.on('end', ()=>console.log('URL2:', d.substring(0,250))); 
});
