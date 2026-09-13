const https = require('https');
https.get('https://www.plusetf.co.kr/product/list', res => {
  let d=''; 
  res.on('data', c=>d+=c);
  res.on('end', () => {
    const match = d.match(/0018C0[\s\S]*?href=\"\/product\/detail\?n=(\d+)\"/i);
    if(match) console.log('ID FOUND:', match[1]);
    else console.log('ID NOT FOUND in list');
  });
});
