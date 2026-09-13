const fetch = require('node-fetch');
const url = 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/refDivAjax.ajax';
(async () => {
  const result = {};
  for(let pageIdx=1; pageIdx<=3; pageIdx++){
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'ksdFund=KR7466940004&pageIndex=' + pageIdx
    });
    const html = await res.text();
    if (!html || !html.includes('<tr')) break;
    const trs = html.split(/<\/tr>/i);
    trs.forEach(tr => {
      const tds = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (tds && tds.length >= 4) {
        const dateRaw = tds[0].replace(/<[^>]+>/g, '').trim();
        const date = dateRaw.replace(/[\.\-]/g, '').substring(0, 6);
        const dividend = parseInt(tds[2].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10);
        const taxBase = parseInt(tds[3].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10);
        if (date && !isNaN(taxBase) && !isNaN(dividend)) {
          result[date] = { dividend, taxBase };
        }
      }
    });
  }
  console.log(result);
})();
