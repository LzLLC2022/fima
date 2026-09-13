const fs = require('fs');

const cx = 100, cy = 100, r = 70;

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
  // SVG arcs: 0 is large-arc-flag, 1 is sweep-flag (clockwise from start to end)
  // Wait, if angle goes from 180 to 135, it's clockwise.
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
};

console.log('Ext Fear arc:', describeArc(cx, cy, r, 180, 135));
console.log('Fear arc:', describeArc(cx, cy, r, 135, 99));
console.log('Neutral arc:', describeArc(cx, cy, r, 99, 81));
console.log('Greed arc:', describeArc(cx, cy, r, 81, 45));
console.log('Ext Greed arc:', describeArc(cx, cy, r, 45, 0));

const getTextPos = (a) => {
  const p = polarToCartesian(cx, cy, r, a);
  const rot = 90 - a;
  return `x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" transform="rotate(${rot.toFixed(1)}, ${p.x.toFixed(2)}, ${p.y.toFixed(2)})"`;
};

console.log('Ext Fear text:', getTextPos(157.5));
console.log('Fear text:', getTextPos(117));
console.log('Neutral text:', getTextPos(90));
console.log('Greed text:', getTextPos(63));
console.log('Ext Greed text:', getTextPos(22.5));

// Ticks 0, 25, 50, 75, 100.
// Inner track dots.
// Let's use radius 45 for the track dots and texts.
const getTickPos = (a) => polarToCartesian(cx, cy, 40, a);
console.log('Tick 0:', getTickPos(180));
console.log('Tick 25:', getTickPos(135));
console.log('Tick 50:', getTickPos(90));
console.log('Tick 75:', getTickPos(45));
console.log('Tick 100:', getTickPos(0));

