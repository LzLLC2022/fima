const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

// There are two tickerMap objects in fima.html
// One in showIndexDetailPopup, one in loadMarketIndices.
// They look like:
//    const tickerMap = {
//      'KOSPI': '^KS11',
//      'KOSDAQ': '^KQ11',
//      'S&P 500': '^GSPC',
//      'Nasdaq 100': '^NDX',
//      'Dow 30': '^DJI',
//      'Russell 2000': '^RUT',
//      'USD/KRW': 'KRW=X',
//      'JPY/KRW': 'JPYKRW=X'
//    };

const replaceStr = `'JPY/KRW': 'JPYKRW=X',\n      '미국채 10년물': '^TNX',\n      'WTI 지수': 'CL=F'`;

html = html.replace(/'JPY\/KRW': 'JPYKRW=X'/g, replaceStr);

fs.writeFileSync('public/fima.html', html);
console.log('fima.html updated');
