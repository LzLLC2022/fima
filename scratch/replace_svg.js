const fs = require('fs');

const cx = 100, cy = 90, r = 70;

const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
  const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY - (radius * Math.sin(angleInRadians))
  };
};

const describeArc = (x, y, radius, startAngle, endAngle) => {
  const start = polarToCartesian(x, y, radius, startAngle);
  const end = polarToCartesian(x, y, radius, endAngle);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
};

const getTextPos = (a) => {
  const p = polarToCartesian(cx, cy, r, a);
  const rot = 90 - a;
  return `x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" transform="rotate(${rot.toFixed(1)}, ${p.x.toFixed(2)}, ${p.y.toFixed(2)})"`;
};

const getTickPos = (a) => {
  const p = polarToCartesian(cx, cy, 38, a);
  return `x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}"`;
};

// Generate SVG string
let newSvg = `<svg width="100%" height="100%" viewBox="0 0 200 110" style="overflow: visible;">
              <!-- Wedges -->
              <path id="fg-arc-ext-fear" d="${describeArc(cx, cy, r, 180, 136.5)}" fill="none" stroke="#f4f4f4" stroke-width="36" />
              <path id="fg-arc-fear" d="${describeArc(cx, cy, r, 133.5, 100.5)}" fill="none" stroke="#f4f4f4" stroke-width="36" />
              <path id="fg-arc-neutral" d="${describeArc(cx, cy, r, 97.5, 82.5)}" fill="none" stroke="#f4f4f4" stroke-width="36" />
              <path id="fg-arc-greed" d="${describeArc(cx, cy, r, 79.5, 46.5)}" fill="none" stroke="#f4f4f4" stroke-width="36" />
              <path id="fg-arc-ext-greed" d="${describeArc(cx, cy, r, 43.5, 0)}" fill="none" stroke="#f4f4f4" stroke-width="36" />
              
              <!-- Wedge Texts -->
              <text id="fg-text-ext-fear" ${getTextPos(158)} font-size="6" font-weight="800" fill="#a0aec0" text-anchor="middle" dominant-baseline="middle">EXTREME FEAR</text>
              <text id="fg-text-fear" ${getTextPos(117)} font-size="6" font-weight="800" fill="#a0aec0" text-anchor="middle" dominant-baseline="middle">FEAR</text>
              <text id="fg-text-neutral" ${getTextPos(90)} font-size="6" font-weight="800" fill="#a0aec0" text-anchor="middle" dominant-baseline="middle">NEUTRAL</text>
              <text id="fg-text-greed" ${getTextPos(63)} font-size="6" font-weight="800" fill="#a0aec0" text-anchor="middle" dominant-baseline="middle">GREED</text>
              <text id="fg-text-ext-greed" ${getTextPos(22)} font-size="6" font-weight="800" fill="#a0aec0" text-anchor="middle" dominant-baseline="middle">EXTREME GREED</text>
              
              <!-- Scale Ticks & Numbers -->
              <!-- Track Dots -->
`;

for (let a = 0; a <= 180; a += 18) {
  let p = polarToCartesian(cx, cy, 47, a);
  newSvg += `              <circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="0.8" fill="#a0aec0" />\n`;
}

newSvg += `              <text ${getTickPos(180)} font-size="7" fill="#718096" text-anchor="middle" dominant-baseline="middle">0</text>
              <text ${getTickPos(135)} font-size="7" fill="#718096" text-anchor="middle" dominant-baseline="middle">25</text>
              <text ${getTickPos(90)} font-size="7" fill="#718096" text-anchor="middle" dominant-baseline="middle">50</text>
              <text ${getTickPos(45)} font-size="7" fill="#718096" text-anchor="middle" dominant-baseline="middle">75</text>
              <text ${getTickPos(0)} font-size="7" fill="#718096" text-anchor="middle" dominant-baseline="middle">100</text>
              
              <!-- Needle -->
              <g id="fg-needle" transform="translate(100, 90) rotate(27)">
                <!-- needle body -->
                <polygon points="-1.5,0 1.5,0 0,-60" fill="#2d3748" />
              </g>
              
              <!-- White circle base for value -->
              <circle cx="100" cy="90" r="22" fill="#ffffff" />
            </svg>`;

let html = fs.readFileSync('public/fima.html', 'utf8');
const svgStart = html.indexOf('<svg width="340" height="190" viewBox="0 0 200 110">');
if (svgStart !== -1) {
  const svgEnd = html.indexOf('</svg>', svgStart) + 6;
  const oldSvg = html.substring(svgStart, svgEnd);
  html = html.replace(oldSvg, newSvg);
  fs.writeFileSync('public/fima.html', html, 'utf8');
  console.log('SVG replaced.');
} else {
  console.log('SVG not found!');
}
