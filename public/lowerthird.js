// the title card, a slanted layered panel slides in from the left edge, song details wipe in on top, then slides back out
import { PALETTE, channel, pick, shuffle } from './logo.js';

const SHOW_MS = 8_000;
const LINE_STAGGER_MS = 90;
const LINE_OUT_MS = 300;

const container = () => document.getElementById('lower-third');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// wcag relative luminance and contrast ratio, for #rrggbb colors
function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// black or white text, whichever reads better on the panel
const inkFor = (color) => (contrast(color, '#000000') >= contrast(color, '#ffffff') ? '#000000' : '#ffffff');

// only colors whose best ink clears wcag aa (4.5:1) get to carry the text
const PANEL_COLORS = PALETTE.filter((color) => contrast(color, inkFor(color)) >= 4.5);

// moves: each one animates the panel layers in from the left edge and back out, textAt is when details start wiping in

const run = (layer, keyframes, options) => layer.animate(keyframes, { fill: 'both', ...options }).finished;
const shift = (x, extra = '') => ({ transform: `translateX(${x}) ${extra}`.trim() });
const stretchTo = (x) => ({ transform: `scaleX(${x})`, transformOrigin: 'left center' });

const GLITCH = [
  { transform: 'translateX(-105%)', filter: 'none', offset: 0 },
  { transform: 'translateX(-58%) skewX(-16deg)', filter: 'hue-rotate(90deg) saturate(2)', offset: 0.22 },
  { transform: 'translateX(-66%) skewX(8deg)', filter: 'none', offset: 0.32 },
  { transform: 'translateX(-20%) skewX(-10deg)', filter: 'hue-rotate(-120deg) brightness(1.5)', offset: 0.52 },
  { transform: 'translateX(-27%)', filter: 'none', offset: 0.62 },
  { transform: 'translateX(5%) skewX(6deg)', filter: 'hue-rotate(45deg)', offset: 0.82 },
  { transform: 'translateX(0)', filter: 'none', offset: 1 },
];
const GLITCH_OUT = [...GLITCH].reverse().map((frame) => ({ ...frame, offset: 1 - frame.offset }));

const MOVES = {
  // a clean slide with a little overshoot
  slide: {
    textAt: 330,
    enter: (layers) => Promise.all(layers.map((layer, i) => run(layer, [shift('-105%'), shift('0')], { duration: 520, delay: i * 45, easing: 'cubic-bezier(.2,.9,.3,1.15)' }))),
    exit: (layers) => Promise.all([...layers].reverse().map((layer, i) => run(layer, [shift('0'), shift('-105%')], { duration: 380, delay: i * 45, easing: 'cubic-bezier(.6,0,.9,.35)' }))),
  },
  // jumps in and out in stuttering color shifted steps, like bad reception
  glitch: {
    textAt: 520,
    enter: (layers) => Promise.all(layers.map((layer, i) => run(layer, GLITCH, { duration: 620, delay: i * 30, easing: 'steps(14)' }))),
    exit: (layers) => Promise.all(layers.map((layer, i) => run(layer, GLITCH_OUT, { duration: 480, delay: (layers.length - 1 - i) * 30, easing: 'steps(12)' }))),
  },
  // layers arrive one after another back to front, leave front to back
  layered: {
    textAt: 560,
    enter: ([back, shadow, front]) => Promise.all([
      run(back, [shift('-105%'), shift('0')], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }),
      run(shadow, [shift('-105%'), shift('0')], { duration: 460, delay: 110, easing: 'cubic-bezier(.2,.8,.2,1)' }),
      run(front, [shift('-105%'), shift('3%'), shift('0')], { duration: 560, delay: 220, easing: 'ease-out' }),
    ]),
    exit: ([back, shadow, front]) => Promise.all([
      run(front, [shift('0'), shift('-105%')], { duration: 340, easing: 'ease-in' }),
      run(shadow, [shift('0'), shift('-105%')], { duration: 340, delay: 90, easing: 'ease-in' }),
      run(back, [shift('0'), shift('-105%')], { duration: 340, delay: 180, easing: 'ease-in' }),
    ]),
  },
  // unrolls from the screen edge and rolls back up into it
  stretch: {
    textAt: 360,
    enter: (layers) => Promise.all(layers.map((layer, i) => run(layer, [stretchTo(0), { ...stretchTo(1.04), offset: 0.75 }, stretchTo(1)], { duration: 480, delay: i * 60, easing: 'cubic-bezier(.3,.9,.3,1)' }))),
    exit: (layers) => Promise.all([...layers].reverse().map((layer, i) => run(layer, [stretchTo(1), stretchTo(0)], { duration: 320, delay: i * 50, easing: 'cubic-bezier(.7,0,.9,.4)' }))),
  },
  // whooshes in leaning forward, rocks back into place, whooshes away
  whoosh: {
    textAt: 420,
    enter: (layers) => Promise.all(layers.map((layer, i) => run(layer, [
      shift('-125%', 'skewX(30deg)'),
      { ...shift('4%', 'skewX(-10deg)'), offset: 0.7 },
      { ...shift('-1%', 'skewX(3deg)'), offset: 0.86 },
      shift('0', 'skewX(0deg)'),
    ], { duration: 600, delay: i * 50, easing: 'ease-out' }))),
    exit: (layers) => Promise.all([...layers].reverse().map((layer, i) => run(layer, [
      shift('0', 'skewX(0deg)'),
      { ...shift('3%', 'skewX(-6deg)'), offset: 0.25 },
      shift('-125%', 'skewX(30deg)'),
    ], { duration: 460, delay: i * 45, easing: 'ease-in' }))),
  },
};

export const TITLE_MOVES = Object.keys(MOVES);

// card

function buildCard(item) {
  const front = pick(PANEL_COLORS);
  const [back, stripeA, stripeB] = shuffle(PALETTE.filter((color) => color !== front));
  const card = document.createElement('div');
  card.className = 'lt-card';
  const colors = { front, back, 'stripe-a': stripeA, 'stripe-b': stripeB, ink: inkFor(front) };
  for (const [name, value] of Object.entries(colors)) card.style.setProperty(`--lt-${name}`, value);

  const layers = ['lt-back', 'lt-shadow', 'lt-front'].map((name) => {
    const layer = document.createElement('div');
    layer.className = `lt-layer ${name}`;
    return layer;
  });
  const stripe = document.createElement('div');
  stripe.className = 'lt-stripe';
  layers[2].append(stripe);

  const live = item.video?.live;
  // year the song came out, or for a live clip the year and place it was filmed if known
  const when = live ? [item.video.recordedYear, item.video.recordedPlace].filter(Boolean).join(' · ') : item.year;
  const details = [
    [item.artists.join(', '), 'lt-artist'],
    [`"${item.title}"`, 'lt-title'],
    [item.album, 'lt-small'],
    [when, 'lt-small'],
  ];
  if (live) {
    // names the live music channel unless the place already says it
    const { liveSource, recordedPlace } = item.video;
    const named = liveSource && !recordedPlace?.toLowerCase().includes(liveSource.toLowerCase());
    details.push([named ? `Live · ${liveSource}` : 'Live', 'lt-tag']);
  }
  if (item.source === 'discovery') {
    const tag = `${channel.letter}TV Discovery`;
    details.push([item.seed ? `${tag} · because you like ${item.seed.artist}` : tag, 'lt-tag']);
  }
  const text = document.createElement('div');
  text.className = 'lt-text';
  details.filter(([value]) => value).forEach(([value, className], i) => {
    const line = document.createElement('div');
    line.className = `lt-line ${className}`;
    line.textContent = value;
    line.style.animationDelay = `${i * LINE_STAGGER_MS}ms`;
    text.append(line);
  });

  card.append(...layers, text);
  return { card, layers, text };
}

let showing = null;

// move picks one of TITLE_MOVES, otherwise it's random
export function showLowerThird(item, move = pick(TITLE_MOVES)) {
  if (showing) {
    clearTimeout(showing.textTimer);
    clearTimeout(showing.hideTimer);
  }
  const entry = { ...buildCard(item), move: MOVES[move] };
  showing = entry;
  container().replaceChildren(entry.card); // drops any card still on screen or on its way out
  entry.move.enter(entry.layers).catch(() => {});
  entry.textTimer = setTimeout(() => entry.text.classList.add('show'), entry.move.textAt);
  entry.hideTimer = setTimeout(hideLowerThird, SHOW_MS);
}

export async function hideLowerThird() {
  const entry = showing;
  if (!entry) return;
  showing = null;
  clearTimeout(entry.textTimer);
  clearTimeout(entry.hideTimer);
  if (entry.text.classList.contains('show')) {
    entry.text.classList.replace('show', 'hide');
    await wait(LINE_OUT_MS + entry.text.children.length * LINE_STAGGER_MS);
  }
  await entry.move.exit(entry.layers).catch(() => {});
  entry.card.remove();
}
