// boot screen for the first tune in, the set powers back on after the tune in screen switches off and holds until the first clip is ready (tv.js)
import { BOOT_TIMING } from './jingles.js';
import { PALETTE, PATTERNS, channel, createLogo, pick, pickColors, shuffle, styleLogo } from './logo.js';
import { runNoise } from './transitions.js';

const BARS = ['#ffffff', '#ffe600', '#00e5ff', '#7cff00', '#ff2d95', '#ff2146', '#2a3cff'];
const METER_STEPS = 10;
const STAMP_IN = [
  { transform: 'scale(3) rotate(-25deg)', opacity: 0 },
  { transform: 'scale(.92) rotate(3deg)', opacity: 1, offset: 0.75 },
  { transform: 'scale(1) rotate(0deg)', opacity: 1 },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function bootScreen() {
  // warming up: static over color bars, the channel display and a signal meter
  const noise = el('canvas', 'b-noise');
  const bars = el('div', 'b-bars');
  bars.append(...BARS.map((color) => {
    const bar = el('span', '');
    bar.style.background = color;
    return bar;
  }));
  const steps = Array.from({ length: METER_STEPS }, () => el('i', ''));
  const meter = el('div', 'b-meter');
  meter.append(...steps);
  const osd = el('div', 'b-osd');
  osd.append(el('div', '', 'CH 01'), el('div', '', `${channel.letter}TV`), meter);
  const warmup = el('div', 'b-warmup');
  warmup.append(bars, noise, osd, el('div', 'b-standby', 'Starting broadcast'));

  // the show: spinning rays behind the logo, the tagline, the station letters, then on air
  const rays = el('div', 'b-rays');
  const spot = el('div', 'b-spot');
  const logo = createLogo({ pattern: pick(PATTERNS), colors: pickColors() });
  const logoBox = el('div', 'b-logo');
  logoBox.append(logo);
  const letters = el('div', 'b-letters');
  const letterSpans = [channel.letter, 'T', 'V'].map((text, i) => {
    const span = el('span', '', text);
    span.style.color = ['#ffe600', '#00e5ff', '#ff2d95'][i];
    return span;
  });
  letters.append(...letterSpans);
  const onAir = el('div', 'b-onair', 'On air');
  const callout = el('div', 'b-callout');
  callout.append(letters, onAir);
  const content = el('div', 'b-content');
  content.append(logoBox, el('div', 't-tagline', `${channel.name} Television`), callout);
  const show = el('div', 'b-show');
  show.append(rays, spot, content);

  const flash = el('div', 'b-flash');
  const screen = el('div', 'b-screen');
  screen.append(warmup, show, flash);
  const wrap = el('div', 'boot');
  wrap.append(screen);

  const timers = [];
  let timing = BOOT_TIMING;
  let started = 0;
  let stopNoise = () => {};
  let spinning = null;
  let holding = 0;
  const at = (seconds, action) => timers.push(setTimeout(action, Math.max(0, started + seconds * 1000 - performance.now())));
  const flashOnce = () => flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  const pulse = () => logo.animate([{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  const restyle = () => {
    const [a, b] = shuffle(PALETTE);
    rays.style.background = `repeating-conic-gradient(${a} 0 10deg, ${b} 10deg 20deg)`;
    styleLogo(logo, { pattern: pick(PATTERNS), colors: pickColors([a, b]) });
  };

  // the jingle's hit: a flash, the logo stamped in, a restyle on every chord change
  const hit = () => {
    flashOnce();
    stopNoise();
    warmup.remove();
    restyle();
    show.classList.add('on');
    spinning = rays.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 9000, iterations: Infinity });
    logoBox.animate(STAMP_IN, { duration: 380, easing: 'ease-out', fill: 'both' });
    content.children[1].animate([{ letterSpacing: '1.2em', opacity: 0 }, { letterSpacing: '.35em', opacity: 1 }], { duration: 600, delay: 250, easing: 'ease-out', fill: 'both' });
    for (let beat = 1; beat < 8; beat++) {
      at(timing.hit + beat * timing.beat, () => {
        pulse();
        if (beat % 2 === 0) restyle();
      });
    }
  };
  // the break: rays go dark, a spotlight stays on the logo while the voice calls out the letters
  const drop = () => {
    rays.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
  };
  const callOut = (span) => span.animate(
    [{ transform: 'translateY(40%) scale(.4)', opacity: 0 }, { transform: 'translateY(-8%) scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
    { duration: 260, easing: 'ease-out', fill: 'both' },
  );
  // the final chord: everything comes back faster, on air takes the letters' place until the clip is ready
  const land = () => {
    flashOnce();
    restyle();
    rays.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' });
    spot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    if (spinning) spinning.playbackRate = 2.5;
    letters.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-60%)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    onAir.animate(STAMP_IN, { duration: 380, delay: 80, easing: 'ease-out', fill: 'both' });
    holding = setInterval(() => {
      pulse();
      restyle();
    }, timing.beat * 2000);
  };

  return {
    hidesBug: true,
    // jingleTiming is what playBootJingle returned, falls back to the defaults without sound
    async cover(jingleTiming) {
      timing = jingleTiming ?? BOOT_TIMING;
      started = performance.now();
      document.getElementById('transition').append(wrap);
      stopNoise = runNoise(noise);
      noise.animate([{ opacity: 0.95 }, { opacity: 0.3 }], { duration: (timing.hit - 0.5) * 1000, delay: 300, fill: 'both' });
      bars.animate([{ opacity: 0 }, { opacity: 0.85 }], { duration: 600, delay: 800, fill: 'both' });
      osd.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: 450, fill: 'both' });
      steps.forEach((step, i) => step.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 1, delay: 800 + ((timing.hit - 1.1) * 1000 * (i + 1)) / METER_STEPS, fill: 'both' }));
      at(timing.hit, hit);
      at(timing.hit + 8 * timing.beat, drop);
      letterSpans.forEach((span, i) => at(timing.voice + 0.05 + i * 0.3, () => callOut(span)));
      at(timing.final, land);
      // powering on: a dot stretches into a line, then opens into the picture, white hot at first
      await screen.animate(
        [
          { transform: 'scale(0.004, 0.005)', filter: 'brightness(6)' },
          { transform: 'scale(1, 0.005)', filter: 'brightness(6)', offset: 0.35 },
          { transform: 'scale(1, 1)', filter: 'brightness(2.5)', offset: 0.8 },
          { transform: 'scale(1, 1)', filter: 'brightness(1)' },
        ],
        { duration: 480, easing: 'ease-out', fill: 'both' },
      ).finished;
    },
    // resolves once the final chord has had its moment, when the screen may open
    untilOpen: () => new Promise((resolve) => setTimeout(resolve, Math.max(0, started + timing.open * 1000 - performance.now()))),
    async reveal() {
      timers.forEach(clearTimeout);
      clearInterval(holding);
      await Promise.all([
        logoBox.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(9)', opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished,
        wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, delay: 150, easing: 'ease-in', fill: 'both' }).finished,
      ]);
      stopNoise();
      spinning?.cancel();
      wrap.remove();
    },
  };
}
