'use strict';

// Рисует SVG-картинку часов. Нужна, пока у товара нет настоящего фото.
// Внешний вид однозначно зависит от строки-зерна (slug), поэтому картинка стабильна.

const CASES = [
  ['#ecd08e', '#8a6b2c'], // золото
  ['#eef0f2', '#8c949b'], // сталь
  ['#f0c6b0', '#a6735a'], // розовое золото
  ['#4a4e54', '#15171a'], // чёрный
];
const DIALS = ['#f6f1e6', '#16233b', '#101214', '#1f3d34', '#e9dcc0', '#6b1f2b'];
const STRAPS = [
  { fill: '#6b4423', stitch: '#d8c3a0' },
  { fill: '#17181a', stitch: '#4a4e54' },
  { fill: '#9aa1a7', stitch: null }, // браслет
  { fill: '#1b2a4a', stitch: '#7d8db3' },
  { fill: '#2d4a3a', stitch: '#a9c4b3' },
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isDark(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

function watchSvg(seed) {
  const h = hash(String(seed));
  const [caseLight, caseDark] = CASES[h % CASES.length];
  const dial = DIALS[(h >>> 3) % DIALS.length];
  const strap = STRAPS[(h >>> 6) % STRAPS.length];
  const square = (h >>> 9) % 4 === 0;
  const ink = isDark(dial) ? '#f2eee4' : '#1a1b1e';
  const accent = isDark(dial) ? caseLight : '#a8741a';

  const cx = 200;
  const cy = 250;

  // Ремешок: верхняя и нижняя части
  let strapShapes = '';
  strapShapes += `<path d="M150 0h100l-8 168h-84z" fill="${strap.fill}"/>`;
  strapShapes += `<path d="M158 332h84l8 168h-100z" fill="${strap.fill}"/>`;
  if (strap.stitch) {
    strapShapes += `<path d="M162 8 168 160M238 8 232 160M168 340 162 492M232 340 238 492" stroke="${strap.stitch}" stroke-width="2" stroke-dasharray="6 5" fill="none" opacity=".8"/>`;
  } else {
    // звенья браслета
    for (let y = 18; y < 170; y += 22) {
      strapShapes += `<path d="M${152 + y * 0.05} ${y}h${96 - y * 0.1}" stroke="#6c737a" stroke-width="2"/>`;
    }
    for (let y = 348; y < 500; y += 22) {
      strapShapes += `<path d="M${158 - (y - 340) * 0.05} ${y}h${84 + (y - 340) * 0.1}" stroke="#6c737a" stroke-width="2"/>`;
    }
  }

  // Корпус и циферблат
  let body;
  if (square) {
    body = `
      <rect x="108" y="158" width="184" height="184" rx="34" fill="url(#case)"/>
      <rect x="120" y="170" width="160" height="160" rx="26" fill="${caseDark}" opacity=".35"/>
      <rect x="126" y="176" width="148" height="148" rx="22" fill="${dial}"/>`;
  } else {
    body = `
      <circle cx="${cx}" cy="${cy}" r="102" fill="url(#case)"/>
      <circle cx="${cx}" cy="${cy}" r="92" fill="${caseDark}" opacity=".35"/>
      <circle cx="${cx}" cy="${cy}" r="86" fill="${dial}"/>`;
  }

  // Отметки часов
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const major = i % 3 === 0;
    const r1 = square ? 58 : 66;
    const r2 = r1 - (major ? 14 : 8);
    const x1 = cx + Math.sin(a) * r1;
    const y1 = cy - Math.cos(a) * r1;
    const x2 = cx + Math.sin(a) * r2;
    const y2 = cy - Math.cos(a) * r2;
    ticks += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${major ? accent : ink}" stroke-width="${major ? 4 : 2}" stroke-linecap="round"/>`;
  }

  // Стрелки: 10:10
  const hand = (deg, len, w, color) => {
    const a = (deg * Math.PI) / 180;
    const x = cx + Math.sin(a) * len;
    const y = cy - Math.cos(a) * len;
    return `<path d="M${cx} ${cy}L${x.toFixed(1)} ${y.toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  const hands =
    hand(305, 34, 6, ink) + hand(60, 50, 4, ink) + hand(180, 56, 1.6, accent) +
    `<circle cx="${cx}" cy="${cy}" r="5" fill="${accent}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" role="img" aria-label="Часы">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#e6e0d2"/>
    </linearGradient>
    <linearGradient id="case" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${caseLight}"/><stop offset="1" stop-color="${caseDark}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="500" fill="url(#bg)"/>
  ${strapShapes}
  <rect x="290" y="${cy - 14}" width="16" height="28" rx="4" fill="${caseDark}"/>
  ${body}
  ${ticks}
  ${hands}
</svg>`;
}

module.exports = { watchSvg };
