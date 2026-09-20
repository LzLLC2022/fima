const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('scratch/ray_dalio.html', 'utf8'));
const items = [];
$('.share__top-box').each((i, el) => {
  if (i >= 5) return;
  const a = $(el).find('a.share__company-link');
  const ticker = a.attr('href').split('/').pop().toUpperCase();
  const name = a.find('img').attr('alt');
  const info = $(el).text().replace(/\s+/g, ' ').trim();
  items.push({ ticker, name, info });
});
console.log(JSON.stringify(items, null, 2));
