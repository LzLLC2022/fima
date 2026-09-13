const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

// The original problematic block:
const target = `    var loading = document.getElementById('labPfLoading');
    var errEl   = document.getElementById('labPfError');
    var content = document.getElementById('labPfContent');
    loading.style.display = 'block';
    errEl.style.display   = 'none';
    content.style.display = 'none';`;

const replacement = `    var loading = document.getElementById('labPfLoading');
    var errEl   = document.getElementById('labPfError');
    var content = document.getElementById('labPfContent');
    if (loading) loading.style.display = 'block';
    if (errEl) errEl.style.display   = 'none';
    if (content) content.style.display = 'none';`;

if (html.includes(target)) {
    html = html.replace(target, replacement);
    fs.writeFileSync('public/fima.html', html, 'utf8');
    console.log("Replaced successfully!");
} else {
    console.log("Target string not found. Trying regex...");
    const regex = /var loading = document\.getElementById\('labPfLoading'\);\s*var errEl   = document\.getElementById\('labPfError'\);\s*var content = document\.getElementById\('labPfContent'\);\s*loading\.style\.display = 'block';\s*errEl\.style\.display   = 'none';\s*content\.style\.display = 'none';/g;
    
    html = html.replace(regex, replacement);
    fs.writeFileSync('public/fima.html', html, 'utf8');
    console.log("Replaced using regex.");
}
