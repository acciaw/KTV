// the page's one web audio graph, shared by transition hiss and jingles, starts on the tune in key press
const LEVEL = 0.85;

let context = null;
let output = null;
let muted = false;

export function initAudio() {
  try {
    context ??= new AudioContext();
    context.resume();
    if (!output) {
      // soft compressor keeps jingles at a steady level next to the music videos
      const compressor = new DynamicsCompressorNode(context, { threshold: -16, knee: 10, ratio: 4, attack: 0.004, release: 0.25 });
      output = new GainNode(context, { gain: LEVEL });
      output.connect(compressor).connect(context.destination);
    }
  } catch {
    context = null;
    output = null;
  }
}

export const audio = () => (output ? { context, output } : null);

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  output?.gain.setTargetAtTime(value ? 0 : LEVEL, context.currentTime, 0.03);
  if (value) window.speechSynthesis?.cancel();
}
