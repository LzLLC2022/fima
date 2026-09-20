const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('scratch/ray_dalio.html', 'utf8');
const $ = cheerio.load(html);

const items = [];
$('.share__top-box-link').each((i, el) => {
  if (i >= 10) return;
  
  const companyLink = $(el).find('.share__company-link').attr('href'); // e.g. /stocks/spy
  let ticker = companyLink ? companyLink.split('/').pop().toUpperCase() : '';
  const name = $(el).find('.share__company-sector').first().text().trim(); // actually the alt of img or h3
  const imgAlt = $(el).find('.share__company-logo').attr('alt');
  
  const statValues = $(el).find('.share-stat__value');
  const percentage = $(statValues[0]).text().trim(); // Portfolio %
  const shares = $(statValues[1]).text().trim(); // Shares
  const value = $(statValues[2]).text().trim(); // Value
  
  const chg = $(el).find('.share-stat__change').first().text().trim(); // Change in portfolio

  items.push({
    ticker,
    name: imgAlt || name,
    percentage,
    shares,
    value,
    change: chg
  });
});

console.log(items);
