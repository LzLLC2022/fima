const fs = require('fs');

let html = fs.readFileSync('public/fima.html', 'utf8');

// Add helper functions
if (!html.includes('formatNumberInput(el)')) {
  const helpers = `
  function formatNumberInput(el) {
    let val = el.value.replace(/[^0-9]/g, '');
    if (val === '') {
      el.value = '';
    } else {
      el.value = Number(val).toLocaleString();
    }
  }
  function unformatNumber(str) {
    return Number((str + '').replace(/,/g, '')) || 0;
  }
`;
  html = html.replace('let tempRealEstates = [];', helpers + '\n  let tempRealEstates = [];');
}

// 1. Static inputs type and oninput
html = html.replace(
  /<input type="number" id="inpAssetFin"(.*?)\/>/g,
  '<input type="text" id="inpAssetFin" oninput="formatNumberInput(this)"$1/>'
);
html = html.replace(
  /<input type="number" id="inpAssetOther"(.*?)\/>/g,
  '<input type="text" id="inpAssetOther" oninput="formatNumberInput(this)"$1/>'
);
html = html.replace(
  /<input type="number" id="inpLiabMort"(.*?)\/>/g,
  '<input type="text" id="inpLiabMort" oninput="formatNumberInput(this)"$1/>'
);
html = html.replace(
  /<input type="number" id="inpLiabCred"(.*?)\/>/g,
  '<input type="text" id="inpLiabCred" oninput="formatNumberInput(this)"$1/>'
);
html = html.replace(
  /<input type="number" id="inpLiabOther"(.*?)\/>/g,
  '<input type="text" id="inpLiabOther" oninput="formatNumberInput(this)"$1/>'
);

// 2. Dynamic inputs (realEstate)
html = html.replace(
  /<input type="number" onchange="updateRealEstateItem\(\\\${item\.id}, 'inv', Number\(this\.value\)\)" value="\\\${item\.inv \|\| 0}"/g,
  '<input type="text" oninput="formatNumberInput(this)" onchange="updateRealEstateItem(\\${item.id}, \'inv\', unformatNumber(this.value))" value="\\${(item.inv || 0).toLocaleString()}"'
);
html = html.replace(
  /<input type="number" onchange="updateRealEstateItem\(\\\${item\.id}, 'mkt', Number\(this\.value\)\)" value="\\\${item\.mkt \|\| 0}"/g,
  '<input type="text" oninput="formatNumberInput(this)" onchange="updateRealEstateItem(\\${item.id}, \'mkt\', unformatNumber(this.value))" value="\\${(item.mkt || 0).toLocaleString()}"'
);

// 3. openAssetModal initialization
html = html.replace(
  /document\.getElementById\('inpAssetFin'\)\.value = data\.finAsset \|\| 0;/g,
  'document.getElementById(\'inpAssetFin\').value = (data.finAsset || 0).toLocaleString();'
);
html = html.replace(
  /document\.getElementById\('inpAssetOther'\)\.value = data\.otherAsset \|\| 0;/g,
  'document.getElementById(\'inpAssetOther\').value = (data.otherAsset || 0).toLocaleString();'
);
html = html.replace(
  /document\.getElementById\('inpLiabMort'\)\.value = data\.liabMort \|\| 0;/g,
  'document.getElementById(\'inpLiabMort\').value = (data.liabMort || 0).toLocaleString();'
);
html = html.replace(
  /document\.getElementById\('inpLiabCred'\)\.value = data\.liabCred \|\| 0;/g,
  'document.getElementById(\'inpLiabCred\').value = (data.liabCred || 0).toLocaleString();'
);
html = html.replace(
  /document\.getElementById\('inpLiabOther'\)\.value = data\.liabOther \|\| 0;/g,
  'document.getElementById(\'inpLiabOther\').value = (data.liabOther || 0).toLocaleString();'
);

// 4. saveAssetModal retrieval
html = html.replace(
  /data\.finAsset = Number\(document\.getElementById\('inpAssetFin'\)\.value\) \|\| 0;/g,
  'data.finAsset = unformatNumber(document.getElementById(\'inpAssetFin\').value);'
);
html = html.replace(
  /data\.otherAsset = Number\(document\.getElementById\('inpAssetOther'\)\.value\) \|\| 0;/g,
  'data.otherAsset = unformatNumber(document.getElementById(\'inpAssetOther\').value);'
);
html = html.replace(
  /data\.liabMort = Number\(document\.getElementById\('inpLiabMort'\)\.value\) \|\| 0;/g,
  'data.liabMort = unformatNumber(document.getElementById(\'inpLiabMort\').value);'
);
html = html.replace(
  /data\.liabCred = Number\(document\.getElementById\('inpLiabCred'\)\.value\) \|\| 0;/g,
  'data.liabCred = unformatNumber(document.getElementById(\'inpLiabCred\').value);'
);
html = html.replace(
  /data\.liabOther = Number\(document\.getElementById\('inpLiabOther'\)\.value\) \|\| 0;/g,
  'data.liabOther = unformatNumber(document.getElementById(\'inpLiabOther\').value);'
);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log("Successfully formatted number inputs with commas.");
