const https = require('https');
const fs = require('fs');

https.get('https://stockcircle.com/portfolio/ray-dalio', {
  headers: { 'User-Agent': 'Mozilla/5.0' }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('scratch/ray_dalio.html', data);
    console.log('Saved to scratch/ray_dalio.html');
  });
});
