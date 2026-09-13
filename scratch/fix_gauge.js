const fs = require('fs');

let lines = fs.readFileSync('public/fima.html', 'utf8').split(/\r?\n/);

// 1. Fix gauge-text centering
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.gauge-text { position: absolute;')) {
    lines[i] = '          .gauge-text { position: absolute; bottom: 0px; left: 50%; transform: translateX(-50%); text-align: center; }';
    break;
  }
}

// 2. Fix the background arc and the segments
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('M 20 90 A 70 70 0 0 1 180 90')) {
    lines[i] = lines[i].replace('M 20 90 A 70 70 0 0 1 180 90', 'M 20 90 A 80 80 0 0 1 180 90');
  }
  else if (lines[i].includes('id="fg-arc-ext-fear"')) {
    lines[i] = lines[i].replace(/d=".*?"/, 'd="M 20.0 90.0 A 80 80 0 0 1 42.5 34.4"');
  }
  else if (lines[i].includes('id="fg-arc-fear"')) {
    lines[i] = lines[i].replace(/d=".*?"/, 'd="M 44.4 32.5 A 80 80 0 0 1 86.1 11.2"');
  }
  else if (lines[i].includes('id="fg-arc-neutral"')) {
    lines[i] = lines[i].replace(/d=".*?"/, 'd="M 88.9 10.8 A 80 80 0 0 1 111.1 10.8"');
  }
  else if (lines[i].includes('id="fg-arc-greed"')) {
    lines[i] = lines[i].replace(/d=".*?"/, 'd="M 113.9 11.2 A 80 80 0 0 1 155.6 32.5"');
  }
  else if (lines[i].includes('id="fg-arc-ext-greed"')) {
    lines[i] = lines[i].replace(/d=".*?"/, 'd="M 157.5 34.4 A 80 80 0 0 1 180.0 90.0"');
  }
}

fs.writeFileSync('public/fima.html', lines.join('\n'), 'utf8');
console.log('Fixed SVG arcs and centering.');
