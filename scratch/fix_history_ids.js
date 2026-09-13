const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const target = `    const stEl = document.getElementById(periodId + '-status');
    const bdEl = document.getElementById(periodId + '-badge');`;

const repl = `    const stEl = document.getElementById(periodId + '-text');
    const bdEl = document.getElementById(periodId);`;

if (html.includes(target)) {
    html = html.replace(target, repl);
    fs.writeFileSync('public/fima.html', html, 'utf8');
    console.log('Fixed element IDs');
} else {
    // try with normalize newlines
    html = html.replace(/\r\n/g, '\n');
    const target2 = "    const stEl = document.getElementById(periodId + '-status');\n    const bdEl = document.getElementById(periodId + '-badge');";
    if (html.includes(target2)) {
        html = html.replace(target2, repl);
        fs.writeFileSync('public/fima.html', html, 'utf8');
        console.log('Fixed element IDs (normalized)');
    } else {
        console.log('Could not find target');
    }
}
