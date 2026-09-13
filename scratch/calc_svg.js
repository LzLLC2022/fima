const fs = require('fs');
const r = 80; const cx = 100; const cy = 90;
const getPts = (a, b) => {
  const ra = a * Math.PI / 180;
  const rb = b * Math.PI / 180;
  const x1 = cx + r * Math.cos(ra);
  const y1 = cy - r * Math.sin(ra);
  const x2 = cx + r * Math.cos(rb);
  const y2 = cy - r * Math.sin(rb);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
console.log('Ext Fear:', getPts(180, 136));
console.log('Fear:', getPts(134, 100));
console.log('Neutral:', getPts(98, 82));
console.log('Greed:', getPts(80, 46));
console.log('Ext Greed:', getPts(44, 0));
