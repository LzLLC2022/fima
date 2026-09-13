const https = require('https');
https.get('https://www.soletf.com/ko/fund/detail/0040Y0', res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Found 211088 in HTML?', data.includes('211088'));
    // try to find the api url
    const match = data.match(/\/api\/[^\"\'\s]+/g);
    if(match) console.log('Found APIs:', match.filter(url => url.includes('divid') || url.includes('211088')));
  });
});
