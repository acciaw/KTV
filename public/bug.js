// station bug in the top right corner, restyles every few seconds mid flip spin pop or glitch
import { PATTERNS, createLogo, pick, styleLogo } from './logo.js';

const RESTYLE_EVERY_MS = 5_000;

const turn = (el, from, to, duration, easing) =>
  el.animate([{ transform: from }, { transform: to }], { duration, easing, fill: 'forwards' }).finished;

const MOVES = [
  // card flip, new look is on the back
  async function flip(el, restyle) {
    await turn(el, 'rotateY(0deg)', 'rotateY(90deg)', 220, 'ease-in');
    restyle();
    await turn(el, 'rotateY(-90deg)', 'rotateY(0deg)', 280, 'ease-out');
  },
  // tumble over the horizontal axis
  async function tumble(el, restyle) {
    await turn(el, 'rotateX(0deg)', 'rotateX(90deg)', 220, 'ease-in');
    restyle();
    await turn(el, 'rotateX(-90deg)', 'rotateX(0deg)', 280, 'ease-out');
  },
  // coin spin, new look on every edge
  async function coin(el, restyle) {
    for (let i = 0; i < 4; i++) {
      await turn(el, 'rotateY(0deg)', 'rotateY(90deg)', 80, 'linear');
      restyle();
      await turn(el, 'rotateY(-90deg)', 'rotateY(0deg)', 80, 'linear');
    }
  },
  // spin down to a dot and back up
  async function spin(el, restyle) {
    await turn(el, 'rotate(0deg) scale(1)', 'rotate(-180deg) scale(0.1)', 300, 'ease-in');
    restyle();
    await el.animate(
      [{ transform: 'rotate(180deg) scale(0.1)' }, { transform: 'rotate(10deg) scale(1.2)', offset: 0.75 }, { transform: 'rotate(0deg) scale(1)' }],
      { duration: 450, easing: 'ease-out', fill: 'forwards' },
    ).finished;
  },
  // swell, vanish, bounce back
  async function pop(el, restyle) {
    await el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.5 }, { transform: 'scale(0)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }).finished;
    restyle();
    await el.animate(
      [{ transform: 'scale(0)' }, { transform: 'scale(1.2)', offset: 0.6 }, { transform: 'scale(0.95)', offset: 0.85 }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out', fill: 'forwards' },
    ).finished;
  },
  // jitter with color shifts
  async function glitch(el, restyle) {
    const frames = Array.from({ length: 8 }, (_, i) => ({
      transform: `translate(${(Math.random() - 0.5) * 16}px, ${(Math.random() - 0.5) * 8}px) skewX(${(Math.random() - 0.5) * 30}deg)`,
      filter: `hue-rotate(${i * 45}deg)`,
    }));
    setTimeout(restyle, 240);
    await el.animate(frames, { duration: 480, easing: 'steps(8)' }).finished;
  },
];

export function startBug(container) {
  const logo = createLogo({ pattern: pick(PATTERNS) });
  styleLogo(logo);
  const spinner = document.createElement('div');
  spinner.append(logo);
  container.replaceChildren(spinner);

  setInterval(async () => {
    if (document.hidden) return;
    await pick(MOVES)(spinner, () => styleLogo(logo));
    spinner.getAnimations().forEach((animation) => animation.cancel());
  }, RESTYLE_EVERY_MS);
}
