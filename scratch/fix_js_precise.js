const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const targetFunctionSig = 'function loadLabPortfolioAnalysis(force) {';
const startIdx = html.indexOf(targetFunctionSig);

if (startIdx !== -1) {
    let funcBlock = html.substring(startIdx, startIdx + 3000);
    
    // Fix initial elements display check
    funcBlock = funcBlock.replace(
        "    var loading = document.getElementById('labPfLoading');\r\n    var errEl   = document.getElementById('labPfError');\r\n    var content = document.getElementById('labPfContent');\r\n    loading.style.display = 'block';\r\n    errEl.style.display   = 'none';\r\n    content.style.display = 'none';",
        "    var loading = document.getElementById('labPfLoading');\r\n    var errEl   = document.getElementById('labPfError');\r\n    var content = document.getElementById('labPfContent');\r\n    if (loading) loading.style.display = 'block';\r\n    if (errEl) errEl.style.display   = 'none';\r\n    if (content) content.style.display = 'none';"
    );
    
    // Fix similar block with \n just in case
    funcBlock = funcBlock.replace(
        "    var loading = document.getElementById('labPfLoading');\n    var errEl   = document.getElementById('labPfError');\n    var content = document.getElementById('labPfContent');\n    loading.style.display = 'block';\n    errEl.style.display   = 'none';\n    content.style.display = 'none';",
        "    var loading = document.getElementById('labPfLoading');\n    var errEl   = document.getElementById('labPfError');\n    var content = document.getElementById('labPfContent');\n    if (loading) loading.style.display = 'block';\n    if (errEl) errEl.style.display   = 'none';\n    if (content) content.style.display = 'none';"
    );

    // Add early return if content doesn't exist
    // Just add it after the above logic
    funcBlock = funcBlock.replace(
        "    if (content) content.style.display = 'none';",
        "    if (content) content.style.display = 'none';\n    if (!document.getElementById('labPfNetInv')) { console.log('lab dom missing, skip'); return; }"
    );

    html = html.substring(0, startIdx) + funcBlock + html.substring(startIdx + 3000);
    
    // Fix hook with try-catch
    html = html.replace(
        'if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab);',
        'try { if (window.origSwitchTabLab2) window.origSwitchTabLab2(tab); } catch(e) { console.error("orig switchTab error:", e); }'
    );
    
    fs.writeFileSync('public/fima.html', html, 'utf8');
    console.log('Fixed loadLabPortfolioAnalysis explicitly');
}
