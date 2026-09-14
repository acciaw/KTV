// transitions between clips, each one is { cover(), reveal(), hidesBug }, hidesBug fades the corner logo out while a big logo is on screen, add a style by adding a function to transitions, number keys 1-9 preview them in order
import { PALETTE, PATTERNS, channel, createLogo, pick, pickColors, shuffle, styleLogo } from './logo.js';
import { audio } from './sound.js';

const layer = () => document.getElementById('transition');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function el(tag, className, style = {}) {
  const node = document.createElement(tag);
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

// a big patterned logo centered above everything else in the transition
function centeredLogo(options = {}) {
  const box = el('div', 't-center');
  const logo = createLogo({ pattern: pick(PATTERNS), colors: pickColors(), ...options });
  box.append(logo);
  return { box, logo };
}

const STAMP_IN = [
  { transform: 'scale(3) rotate(-25deg)', opacity: 0 },
  { transform: 'scale(.92) rotate(3deg)', opacity: 1, offset: 0.75 },
  { transform: 'scale(1) rotate(0deg)', opacity: 1 },
];
const SHRINK_OUT = [{ transform: 'scale(1) rotate(0deg)', opacity: 1 }, { transform: 'scale(.2) rotate(40deg)', opacity: 0 }];

// full screen css patterns, move is how far the background slides for one seamless loop
const BACKDROPS = {
  stripes: ([a, b]) => ({ background: `repeating-linear-gradient(45deg, ${a} 0 30px, ${b} 30px 60px) 0 0 / 84.85px 84.85px`, move: '84.85px 0' }),
  dots: ([a, b]) => ({ background: `radial-gradient(circle, ${b} 0 11px, transparent 12px) 0 0 / 44px 44px ${a}`, move: '0 44px' }),
  checker: ([a, b]) => ({ background: `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 80px 80px`, move: '80px 80px' }),
  grid: ([a, b]) => ({ background: `linear-gradient(${b} 0 10px, transparent 0) 0 0 / 56px 56px, linear-gradient(90deg, ${b} 0 10px, transparent 0) 0 0 / 56px 56px ${a}`, move: '56px 56px' }),
  candy: ([a, b, c]) => ({ background: `linear-gradient(90deg, ${a} 0 33.3%, ${b} 0 66.6%, ${c} 0) 0 0 / 120px 100%`, move: '120px 0' }),
  diamonds: ([a, b]) => ({ background: `conic-gradient(from 45deg, ${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 70px 70px`, move: '70px 0' }),
};

function backdrop(node, colors, { name = pick(Object.keys(BACKDROPS)), moving = true } = {}) {
  const { background, move } = BACKDROPS[name](colors);
  node.style.background = background;
  if (!moving) return null;
  return node.animate([{ backgroundPosition: '0 0' }, { backgroundPosition: move }], { duration: 1100, iterations: Infinity });
}

export function runNoise(canvas) {
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  let frame = 0;
  let raf = 0;
  const draw = () => {
    const data = image.data;
    const roll = (frame * 3) % canvas.height;
    for (let y = 0; y < canvas.height; y++) {
      const band = Math.abs(y - roll) < 14 ? 70 : 0;
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.random() * 215 + band;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    frame++;
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

function hiss(seconds) {
  const sound = audio();
  if (!sound) return;
  const { context, output } = sound;
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
  const source = new AudioBufferSourceNode(context, { buffer });
  const gain = new GainNode(context, { gain: 0.0001 });
  const t = context.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  source.connect(gain).connect(output);
  source.start();
}

// memphis style shapes for the memphis transition
const SHAPES = [
  (c) => `<svg viewBox="0 0 110 40"><path d="M5 20 Q17.5 0 30 20 T55 20 T80 20 T105 20" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/></svg>`,
  (c) => `<svg viewBox="0 0 100 100"><polygon points="50,6 96,94 4,94" fill="${c}"/></svg>`,
  (c) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="14"/></svg>`,
  (c) => `<svg viewBox="0 0 100 50"><polyline points="4,42 22,8 40,42 58,8 76,42 94,8" fill="none" stroke="${c}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  (c) => `<svg viewBox="0 0 100 100" fill="${c}">${Array.from({ length: 16 }, (_, i) => `<circle cx="${14 + (i % 4) * 24}" cy="${14 + Math.floor(i / 4) * 24}" r="7"/>`).join('')}</svg>`,
  (c) => `<svg viewBox="0 0 100 100"><path d="M38 0h24v38h38v24H62v38H38V62H0V38h38z" fill="${c}"/></svg>`,
  (c) => `<svg viewBox="0 0 100 50"><path d="M0 50a50 50 0 0 1 100 0z" fill="${c}"/></svg>`,
];

const transitions = {
  // channel surfing static that collapses into a crt line, logo flickering in over the snow
  static() {
    const wrap = el('div', 't-fill');
    const canvas = el('canvas', 't-static');
    const { box } = centeredLogo();
    wrap.append(canvas, box);
    let stop = () => {};
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        stop = runNoise(canvas);
        hiss(0.8);
        const flicker = box.animate(
          [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.1, offset: 0.35 }, { opacity: 1, offset: 0.5 }, { opacity: 0.4, offset: 0.7 }, { opacity: 1 }],
          { duration: 500, delay: 250, easing: 'steps(6)', fill: 'both' },
        );
        await canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'forwards' }).finished;
        await flicker.finished;
      },
      async reveal() {
        hiss(0.25);
        await wrap.animate(
          [
            { opacity: 1, transform: 'scaleY(1)' },
            { opacity: 1, transform: 'scaleY(0.004)', offset: 0.7 },
            { opacity: 0, transform: 'scaleX(0) scaleY(0.004)' },
          ],
          { duration: 340, easing: 'ease-in', fill: 'forwards' },
        ).finished;
        stop();
        wrap.remove();
      },
    };
  },

  // patterned bars slam in from alternating sides, the logo gets stamped on top
  blocks() {
    const colors = shuffle(PALETTE);
    const wrap = el('div', 't-fill');
    const loops = [];
    const bars = Array.from({ length: 6 }, (_, i) => {
      const bar = el('div', 't-bar', { top: `${(i * 100) / 6}%`, height: `${100 / 6 + 0.5}%` });
      if (i % 2) bar.style.background = colors[i];
      else loops.push(backdrop(bar, [colors[i], colors[i + 1], colors[i + 2]]));
      wrap.append(bar);
      return bar;
    });
    const { box } = centeredLogo();
    wrap.append(box);
    const side = (i) => (i % 2 ? 1 : -1);
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        const stamp = box.animate(STAMP_IN, { duration: 380, delay: bars.length * 60 + 300, easing: 'ease-out', fill: 'both' });
        await Promise.all([
          ...bars.map((bar, i) => bar.animate(
            [{ transform: `translateX(${side(i) * 105}%)` }, { transform: 'translateX(0)' }],
            { duration: 420, delay: i * 60, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' },
          ).finished),
          stamp.finished,
        ]);
        await wait(400);
      },
      async reveal() {
        await Promise.all([
          box.animate(SHRINK_OUT, { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished,
          ...bars.map((bar, i) => bar.animate(
            [{ transform: 'translateX(0)' }, { transform: `translateX(${-side(i) * 105}%)` }],
            { duration: 380, delay: 120 + i * 50, easing: 'cubic-bezier(.7,0,.8,.2)', fill: 'both' },
          ).finished),
        ]);
        loops.forEach((loop) => loop?.cancel());
        wrap.remove();
      },
    };
  },

  // bad vhs tracking: the picture skews and color shifts, drops to black, the logo glitches in
  vhs() {
    const stage = document.getElementById('stage');
    const wrap = el('div', 't-vhs');
    const track = el('div', 't-track');
    const black = el('div', 't-fill t-black');
    const { box } = centeredLogo();
    wrap.append(black, track, box);
    let rolling = null;
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        hiss(0.9);
        const logoIn = box.animate(
          [
            { opacity: 0, transform: 'scaleX(1.8) skewX(-25deg)', filter: 'hue-rotate(0deg)' },
            { opacity: 1, transform: 'scaleX(1) skewX(0deg)', filter: 'hue-rotate(360deg)' },
          ],
          { duration: 420, delay: 850, easing: 'steps(6)', fill: 'both' },
        );
        rolling = track.animate([{ top: '-15%' }, { top: '100%' }], { duration: 650, iterations: Infinity });
        const glitch = stage.animate(
          [
            { transform: 'none', filter: 'none' },
            { transform: 'translateX(-2%) skewX(4deg)', filter: 'hue-rotate(90deg) saturate(3) contrast(1.4)' },
            { transform: 'translateX(3%) skewX(-6deg)', filter: 'hue-rotate(-120deg) saturate(4) contrast(1.8) blur(1px)' },
            { transform: 'translateX(-1%) scaleY(1.05)', filter: 'hue-rotate(200deg) saturate(2) brightness(1.6) blur(2px)' },
          ],
          { duration: 700, easing: 'steps(8)', fill: 'forwards' },
        );
        await glitch.finished;
        await black.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'forwards' }).finished;
        glitch.cancel();
      },
      async reveal() {
        await wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' }).finished;
        rolling?.cancel();
        wrap.remove();
      },
    };
  },

  // the full station ident: iris in, the logo drops in, logo and background keep restyling until we fly through
  bumper() {
    const wrap = el('div', 't-fill');
    const ground = el('div', 't-fill');
    const content = el('div', 't-bumper-content');
    const logoBox = el('div', 't-logo-box');
    const logo = createLogo();
    const tagline = el('div', 't-tagline');
    tagline.textContent = `${channel.name} Television`;
    logoBox.append(logo);
    content.append(logoBox, tagline);
    wrap.append(ground, content);

    let loop = null;
    let cycling = 0;
    // alternates a patterned background under a solid logo with a solid background under a patterned logo
    const restyle = () => {
      const colors = shuffle(PALETTE);
      loop?.cancel();
      loop = null;
      if (Math.random() < 0.5) {
        loop = backdrop(ground, colors.slice(0, 3));
        styleLogo(logo, { pattern: 'solid', colors: colors.slice(3, 6) });
      } else {
        ground.style.background = colors[0];
        styleLogo(logo, { pattern: pick(PATTERNS), colors: colors.slice(1, 4) });
      }
    };
    return {
      hidesBug: true,
      async cover() {
        restyle();
        layer().append(wrap);
        await wrap.animate([{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }], { duration: 420, easing: 'ease-in', fill: 'both' }).finished;
        cycling = setInterval(restyle, 420);
        tagline.animate([{ letterSpacing: '1.2em', opacity: 0 }, { letterSpacing: '.35em', opacity: 1 }], { duration: 600, delay: 400, easing: 'ease-out', fill: 'both' });
        await logoBox.animate(
          [
            { transform: 'translateY(-120vh) rotate(-30deg)' },
            { transform: 'translateY(4vh) rotate(6deg)', offset: 0.7 },
            { transform: 'translateY(-1vh) rotate(-2deg)', offset: 0.85 },
            { transform: 'none' },
          ],
          { duration: 700, easing: 'ease-out', fill: 'both' },
        ).finished;
        await wait(1300);
      },
      async reveal() {
        clearInterval(cycling);
        await Promise.all([
          logoBox.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(9)', opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished,
          wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, delay: 150, easing: 'ease-in', fill: 'both' }).finished,
        ]);
        loop?.cancel();
        wrap.remove();
      },
    };
  },

  // a spinning two tone sunburst sweeps in like a clock hand, the logo spins in from nothing
  sunburst() {
    const [a, b, c] = shuffle(PALETTE);
    const wrap = el('div', 't-fill t-sweep', { background: c });
    const rays = el('div', 't-rays', { background: `repeating-conic-gradient(${a} 0 9deg, ${b} 9deg 18deg)` });
    const { box } = centeredLogo({ colors: pickColors([a, b, c]) });
    wrap.append(rays, box);
    let spinning = null;
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        spinning = rays.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 8000, iterations: Infinity });
        const sweep = wrap.animate([{ '--sweep': '0deg' }, { '--sweep': '360deg' }], { duration: 520, easing: 'ease-in-out', fill: 'both' });
        const spinIn = box.animate(
          [{ transform: 'scale(0) rotate(-540deg)' }, { transform: 'scale(1.15) rotate(12deg)', offset: 0.8 }, { transform: 'scale(1) rotate(0deg)' }],
          { duration: 700, delay: 350, easing: 'ease-out', fill: 'both' },
        );
        await Promise.all([sweep.finished, spinIn.finished]);
        await wait(450);
      },
      async reveal() {
        await Promise.all([
          box.animate([{ transform: 'scale(1) rotate(0deg)', opacity: 1 }, { transform: 'scale(7) rotate(200deg)', opacity: 0 }], { duration: 420, easing: 'ease-in', fill: 'forwards' }).finished,
          wrap.animate([{ '--sweep': '360deg' }, { '--sweep': '0deg' }], { duration: 480, delay: 150, easing: 'ease-in-out', fill: 'both' }).finished,
        ]);
        spinning?.cancel();
        wrap.remove();
      },
    };
  },

  // a wall of colored and patterned tiles flips over in a diagonal wave
  tiles() {
    const cols = 8;
    const rows = 5;
    const colors = shuffle(PALETTE);
    const names = Object.keys(BACKDROPS);
    const wrap = el('div', 't-fill');
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = el('div', 't-tile', { left: `${(c * 100) / cols}%`, top: `${(r * 100) / rows}%`, width: `${100 / cols + 0.15}%`, height: `${100 / rows + 0.15}%` });
        const tone = [colors[(r + c) % 5], colors[5 + ((2 * r + c) % 5)], colors[(r + 2 * c) % 10]];
        if ((r + c) % 3 === 0) backdrop(tile, tone, { name: names[(r * cols + c) % names.length], moving: false });
        else tile.style.background = tone[0];
        wrap.append(tile);
        tiles.push({ tile, wave: r + c });
      }
    }
    const { box } = centeredLogo();
    wrap.append(box);
    const lastWave = rows + cols - 2;
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        const flips = tiles.map(({ tile, wave }) => tile.animate(
          [{ transform: 'perspective(700px) rotateY(90deg)' }, { transform: 'perspective(700px) rotateY(0deg)' }],
          { duration: 320, delay: wave * 45, easing: 'ease-out', fill: 'both' },
        ).finished);
        const stamp = box.animate(STAMP_IN, { duration: 380, delay: lastWave * 45 + 200, easing: 'ease-out', fill: 'both' });
        await Promise.all([...flips, stamp.finished]);
        await wait(400);
      },
      async reveal() {
        await Promise.all([
          box.animate(SHRINK_OUT, { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished,
          ...tiles.map(({ tile, wave }) => tile.animate(
            [{ transform: 'perspective(700px) rotateY(0deg)' }, { transform: 'perspective(700px) rotateY(-90deg)' }],
            { duration: 280, delay: 100 + (lastWave - wave) * 40, easing: 'ease-in', fill: 'both' },
          ).finished),
        ]);
        wrap.remove();
      },
    };
  },

  // venetian blinds snap shut, the logo whooshes in sideways
  blinds() {
    const colors = shuffle(PALETTE);
    const count = 9;
    const wrap = el('div', 't-fill');
    const slats = Array.from({ length: count }, (_, i) => {
      const slat = el('div', 't-slat', { top: `${(i * 100) / count}%`, height: `${100 / count + 0.4}%` });
      if (i % 3 === 1) backdrop(slat, [colors[2 + (i % 5)], colors[7]], { name: 'stripes', moving: false });
      else slat.style.background = colors[i % 3 === 0 ? 0 : 1];
      wrap.append(slat);
      return slat;
    });
    const { box } = centeredLogo({ colors: pickColors([colors[0], colors[1]]) });
    wrap.append(box);
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        const closing = slats.map((slat, i) => slat.animate(
          [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
          { duration: 300, delay: i * 45, easing: 'ease-out', fill: 'both' },
        ).finished);
        const whoosh = box.animate(
          [
            { transform: 'translateX(-120vw) skewX(30deg)' },
            { transform: 'translateX(6vw) skewX(-12deg)', offset: 0.7 },
            { transform: 'translateX(-2vw) skewX(4deg)', offset: 0.85 },
            { transform: 'translateX(0) skewX(0deg)' },
          ],
          { duration: 600, delay: count * 45 + 120, easing: 'ease-out', fill: 'both' },
        );
        await Promise.all([...closing, whoosh.finished]);
        await wait(400);
      },
      async reveal() {
        await Promise.all([
          box.animate([{ transform: 'translateX(0) skewX(0deg)' }, { transform: 'translateX(120vw) skewX(30deg)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' }).finished,
          ...slats.map((slat, i) => slat.animate(
            [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }],
            { duration: 280, delay: 150 + (count - 1 - i) * 40, easing: 'ease-in', fill: 'both' },
          ).finished),
        ]);
        wrap.remove();
      },
    };
  },

  // paint splats burst open one over another until the screen is covered
  splat() {
    const colors = shuffle(PALETTE);
    const wrap = el('div', 't-fill');
    const radius = () => `${40 + Math.random() * 20}%`;
    const blobs = Array.from({ length: 6 }, (_, i) => {
      const blob = el('div', 't-blob', {
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 80}%`,
        borderRadius: `${radius()} ${radius()} ${radius()} ${radius()}`,
      });
      if (i % 2) backdrop(blob, [colors[i], colors[i + 2], colors[i + 4]], { moving: false });
      else blob.style.background = colors[i];
      wrap.append(blob);
      return blob;
    });
    const { box } = centeredLogo({ colors: pickColors([colors[5], colors[7], colors[9]]) });
    wrap.append(box);
    const at = (scale) => ({ transform: `translate(-50%, -50%) scale(${scale})` });
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        const bursts = blobs.map((blob, i) => blob.animate([at(0), at(1)], { duration: 520, delay: i * 110, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }).finished);
        const pop = box.animate(
          [{ transform: 'scale(0) rotate(-20deg)' }, { transform: 'scale(1.25) rotate(8deg)', offset: 0.6 }, { transform: 'scale(0.95) rotate(-3deg)', offset: 0.8 }, { transform: 'scale(1) rotate(0deg)' }],
          { duration: 550, delay: blobs.length * 110 + 150, easing: 'ease-out', fill: 'both' },
        );
        await Promise.all([...bursts, pop.finished]);
        await wait(400);
      },
      async reveal() {
        await box.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)', offset: 0.4 }, { transform: 'scale(0)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }).finished;
        await Promise.all(blobs.map((blob, i) => blob.animate([at(1), at(0)], { duration: 360, delay: (blobs.length - 1 - i) * 70, easing: 'ease-in', fill: 'both' }).finished));
        wrap.remove();
      },
    };
  },

  // 80s memphis design: squiggles, triangles and dot grids fly in over a color wipe and keep floating around the logo
  memphis() {
    const [base, ...inks] = shuffle(PALETTE);
    const wrap = el('div', 't-fill');
    const ground = el('div', 't-fill', { background: base });
    wrap.append(ground);
    const shapes = Array.from({ length: 12 }, (_, i) => {
      const shape = el('div', 't-shape', {
        left: `${(i % 4) * 25 + 2 + Math.random() * 12}%`,
        top: `${Math.floor(i / 4) * 33 + 2 + Math.random() * 14}%`,
        width: `${16 + Math.random() * 14}vmin`,
      });
      // the shape flies in and out as a whole while its body floats the entire time, so no motion ever has to take over from another
      const body = el('div', 't-shape-body');
      body.innerHTML = SHAPES[i % SHAPES.length](inks[i % inks.length]);
      shape.append(body);
      wrap.append(shape);
      return { shape, body, angle: Math.random() * 360, from: [pick([-1, 1]) * 120, pick([-1, 1]) * 120] };
    });
    const { box } = centeredLogo({ colors: pickColors([base]) });
    wrap.append(box);
    const flight = (x, y, angle) => ({ transform: `translate(${x}vw, ${y}vh) rotate(${angle}deg)` });
    const float = (x, y, angle, scale) => ({ transform: `translate(${x}vmin, ${y}vmin) rotate(${angle}deg) scale(${scale})` });
    return {
      hidesBug: true,
      async cover() {
        layer().append(wrap);
        // paint everything once while it's still invisible, so the first frames of motion don't stall on drawing it
        wrap.style.opacity = '0.01';
        await nextFrame();
        await nextFrame();
        wrap.style.opacity = '';
        // a drift, a turn and a swell, so the ring and the dot grid visibly move too, not only the pointy shapes
        shapes.forEach(({ body }, i) => {
          const heading = Math.random() * 2 * Math.PI;
          const distance = 2 + Math.random() * 1.5;
          body.animate(
            [float(0, 0, 0, 1), float(Math.cos(heading) * distance, Math.sin(heading) * distance, pick([-1, 1]) * (8 + Math.random() * 8), 1.06 + Math.random() * 0.06)],
            { duration: 1100 + Math.random() * 700, delay: i * 40, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' },
          );
        });
        const wipe = ground.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 300, easing: 'ease-out', fill: 'both' });
        const arrivals = shapes.map(({ shape, angle, from }, i) => shape.animate(
          [flight(from[0], from[1], angle - 360), flight(0, 0, angle)],
          { duration: 700, delay: 120 + i * 40, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' },
        ).finished);
        const stamp = box.animate(STAMP_IN, { duration: 380, delay: 120 + shapes.length * 40 + 250, easing: 'ease-out', fill: 'both' });
        await Promise.all([wipe.finished, ...arrivals, stamp.finished]);
        await wait(400);
      },
      async reveal() {
        await Promise.all([
          box.animate(SHRINK_OUT, { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished,
          ...shapes.map(({ shape, angle, from }, i) => shape.animate(
            [flight(0, 0, angle), flight(-from[0], -from[1], angle + 360)],
            { duration: 420, delay: i * 25, easing: 'ease-in', fill: 'both' },
          ).finished),
          ground.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 380, delay: 200, easing: 'ease-in', fill: 'both' }).finished,
        ]);
        wrap.remove();
      },
    };
  },
};

export const TRANSITIONS = Object.keys(transitions);

export function makeTransition(kind) {
  return (transitions[kind] ?? transitions.static)();
}

// the bumper is kept for every nth clip, so it isn't part of the random rotation
export const randomTransition = () => pick(TRANSITIONS.filter((kind) => kind !== 'bumper'));
