// the ktv mark, the owner's initial with "tv" spray painted across it, k is hand drawn and other letters use a heavy font

const K_POINTS = '12,10 58,10 58,62 120,10 180,10 102,76 182,140 120,140 58,90 58,140 12,140';

export const PALETTE = ['#ff2d95', '#ffe600', '#00e5ff', '#7cff00', '#ff6a00', '#8b5cff', '#ffffff', '#101010', '#ff2146', '#2a3cff'];

// whose channel this is, pages set it from the server before drawing logos
export const channel = { name: 'Acciaw', letter: 'K' };
export const setChannel = (next) => Object.assign(channel, next);

// same rule as the server, "acciaw" becomes "K", "élodie" becomes "É", blank falls back to the default k
export function initialOf(name) {
  const [first] = new Intl.Segmenter().segment(name.trim() || 'Acciaw');
  return first.segment.toLocaleUpperCase();
}

export const pick = (items) => items[Math.floor(Math.random() * items.length)];

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// three distinct colors, avoids the ones the logo sits on so it never blends into its background
export const pickColors = (avoid = []) => shuffle(PALETTE.filter((color) => !avoid.includes(color))).slice(0, 3);

// patterns scroll forever and draw past a tile's edge so lines don't look pinched where tiles meet
const PATTERN_DEFS = {
  stripes: (id) => `<pattern id="${id}" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
    <rect width="28" height="28" style="fill:var(--c1)"/><rect width="14" height="28" style="fill:var(--c2)"/>
    <animate attributeName="x" from="0" to="28" dur="0.6s" repeatCount="indefinite"/></pattern>`,
  dots: (id) => `<pattern id="${id}" width="22" height="22" patternUnits="userSpaceOnUse">
    <rect width="22" height="22" style="fill:var(--c1)"/><circle cx="11" cy="11" r="6" style="fill:var(--c2)"/>
    <animate attributeName="y" from="0" to="22" dur="0.8s" repeatCount="indefinite"/></pattern>`,
  checker: (id) => `<pattern id="${id}" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
    <rect width="36" height="36" style="fill:var(--c1)"/>
    <rect width="18" height="18" style="fill:var(--c2)"/><rect x="18" y="18" width="18" height="18" style="fill:var(--c2)"/>
    <animate attributeName="x" from="0" to="36" dur="1.2s" repeatCount="indefinite"/></pattern>`,
  zigzag: (id) => `<pattern id="${id}" width="40" height="20" patternUnits="userSpaceOnUse">
    <rect width="40" height="20" style="fill:var(--c1)"/>
    <polyline points="-10,5 0,15 10,5 20,15 30,5 40,15 50,5" fill="none" stroke-width="5" style="stroke:var(--c2)"/>
    <animate attributeName="x" from="0" to="40" dur="0.7s" repeatCount="indefinite"/></pattern>`,
  waves: (id) => `<pattern id="${id}" width="40" height="24" patternUnits="userSpaceOnUse">
    <rect width="40" height="24" style="fill:var(--c1)"/>
    <path d="M-20 12 Q-10 22 0 12 T20 12 T40 12 T60 12" fill="none" stroke-width="6" style="stroke:var(--c2)"/>
    <animate attributeName="x" from="0" to="40" dur="0.9s" repeatCount="indefinite"/></pattern>`,
  triangles: (id) => `<pattern id="${id}" width="30" height="26" patternUnits="userSpaceOnUse">
    <rect width="30" height="26" style="fill:var(--c1)"/><polygon points="0,26 15,0 30,26" style="fill:var(--c2)"/>
    <animate attributeName="y" from="0" to="26" dur="1s" repeatCount="indefinite"/></pattern>`,
  plaid: (id) => `<pattern id="${id}" width="36" height="36" patternUnits="userSpaceOnUse">
    <rect width="36" height="36" style="fill:var(--c1)"/>
    <rect y="12" width="36" height="10" opacity=".8" style="fill:var(--c2)"/><rect x="12" width="10" height="36" opacity=".8" style="fill:var(--c3)"/>
    <animate attributeName="x" from="0" to="36" dur="1.4s" repeatCount="indefinite"/></pattern>`,
  confetti: (id) => `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse">
    <rect width="48" height="48" style="fill:var(--c1)"/>
    <circle cx="9" cy="10" r="5" style="fill:var(--c2)"/><rect x="27" y="5" width="14" height="6" transform="rotate(30 34 8)" style="fill:var(--c3)"/>
    <polygon points="14,28 23,44 5,44" style="fill:var(--c3)"/><circle cx="38" cy="36" r="5" style="fill:var(--c2)"/>
    <animate attributeName="y" from="0" to="48" dur="1.6s" repeatCount="indefinite"/></pattern>`,
  grid: (id) => `<pattern id="${id}" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="24" height="24" style="fill:var(--c1)"/><path d="M0 2H24M2 0V24" stroke-width="4" style="stroke:var(--c2)"/>
    <animate attributeName="y" from="0" to="24" dur="0.8s" repeatCount="indefinite"/></pattern>`,
  sunset: (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" style="stop-color:var(--c1)"/><stop offset=".55" style="stop-color:var(--c2)"/><stop offset="1" style="stop-color:var(--c3)"/>
  </linearGradient>`,
};

export const PATTERNS = Object.keys(PATTERN_DEFS);

const escapeXml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// the letter and its drop shadow, filling the same box as the hand drawn k
function letterMarkup(letter) {
  if (letter === 'K') {
    return `<polygon points="${K_POINTS}" transform="translate(8 8)" fill="rgba(0,0,0,.45)"/>
  <polygon class="ktv-k" points="${K_POINTS}" stroke="#000" stroke-width="4" stroke-linejoin="round"/>`;
  }
  const glyph = escapeXml(letter);
  const text = `x="97" y="140" text-anchor="middle" font-family="'Rubik Mono One', 'Arial Black', sans-serif" font-size="186" text-rendering="geometricPrecision"`;
  return `<text ${text} transform="translate(8 8)" fill="rgba(0,0,0,.45)">${glyph}</text>
  <text class="ktv-k" ${text} stroke="#000" stroke-width="4" stroke-linejoin="round">${glyph}</text>`;
}

let logoCount = 0;

export function createLogo({ pattern = 'solid', colors = ['#ffffff', '#101010', '#ff2d95'], letter = channel.letter } = {}) {
  const holder = document.createElement('div');
  // viewbox leaves room so nothing draws outside it, geometricprecision keeps the tv text sized right at any scale
  holder.innerHTML = `<svg class="ktv-logo" viewBox="0 0 204 184" role="img" aria-label="${escapeXml(letter)}TV" data-uid="ktv${++logoCount}">
  <defs></defs>
  ${letterMarkup(letter)}
  <text x="92" y="138" textLength="70" lengthAdjust="spacingAndGlyphs" text-rendering="geometricPrecision" transform="rotate(-12 140 120)" font-family="'Permanent Marker', cursive" font-size="64" fill="#ff2146" stroke="#000" stroke-width="4" paint-order="stroke">TV</text>
</svg>`;
  const logo = holder.firstElementChild;
  styleLogo(logo, { pattern, colors });
  return logo;
}

// pattern is one of PATTERNS, or solid for a plain --c1 fill
export function styleLogo(logo, { pattern = pick(PATTERNS), colors = pickColors() } = {}) {
  const [c1, c2, c3 = c1] = colors;
  logo.style.setProperty('--c1', c1);
  logo.style.setProperty('--c2', c2);
  logo.style.setProperty('--c3', c3);
  const letter = logo.querySelector('.ktv-k');
  if (!PATTERN_DEFS[pattern]) {
    letter.style.fill = 'var(--c1)';
    return;
  }
  const id = `${logo.dataset.uid}-${pattern}`;
  if (!logo.querySelector(`#${id}`)) logo.querySelector('defs').insertAdjacentHTML('beforeend', PATTERN_DEFS[pattern](id));
  letter.style.fill = `url(#${id})`;
}
