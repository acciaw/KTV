// station jingles for clip changes, a short tune plus a voice calling out the station, synthesized live with web audio, each style runs the recorded voice through its own effects and falls back to speech synthesis without a recording
import { channel, pick } from './logo.js';
import { audio, isMuted } from './sound.js';

const VOICE_LATENCY_MS = 150; // speech engines take a moment to start talking
// how each station id is recorded (scripts/voices.js): a deep us announcer, an upbeat us host, a british host, a soft late night voice
const DELIVERIES = ['deep', 'bright', 'cool', 'soft'];

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const spelled = (punchy) => (punchy ? `${channel.letter}. T. V.` : `${channel.letter} T V`);

// instruments

const buffers = new WeakMap();

// white noise and a reverb impulse, made once per audio context
function sharedBuffers(context) {
  let shared = buffers.get(context);
  if (!shared) {
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const length = Math.floor(context.sampleRate * 2.4);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    shared = { noise, impulse };
    buffers.set(context, shared);
  }
  return shared;
}

// a small mixing desk for one jingle, a dry bus plus reverb and echo sends into the shared output
function studio({ context, output }) {
  const dry = new GainNode(context);
  const reverb = new ConvolverNode(context, { buffer: sharedBuffers(context).impulse });
  const echo = new DelayNode(context, { delayTime: 0.18, maxDelayTime: 1 });
  const feedback = new GainNode(context, { gain: 0.35 });
  dry.connect(output);
  reverb.connect(new GainNode(context, { gain: 0.3 })).connect(output);
  echo.connect(feedback).connect(echo);
  echo.connect(new GainNode(context, { gain: 0.4 })).connect(output);
  return { context, t0: context.currentTime + 0.05, dry, reverb, echo };
}

function route(s, node, { reverb = 0, echo = 0 } = {}) {
  node.connect(s.dry);
  if (reverb) node.connect(new GainNode(s.context, { gain: reverb })).connect(s.reverb);
  if (echo) node.connect(new GainNode(s.context, { gain: echo })).connect(s.echo);
}

// gain that swells to peak over attack seconds and dies away by end
function envelope(context, start, attack, peak, end) {
  const gain = new GainNode(context, { gain: 0.0001 });
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  return gain;
}

function driveCurve(amount) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// rounds every sample to one of a few levels, for an 8 bit crunch
function crushCurve(bits) {
  const steps = 2 ** (bits - 1);
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.round(((i / (curve.length - 1)) * 2 - 1) * steps) / steps;
  return curve;
}

// a pitched voice, detuned oscillators, an optional filter sweep and drive, then an envelope
function note(s, { at, dur, freq, type = 'sine', gain = 0.1, attack = 0.005, detune = [0], glide, filter, drive, sends }) {
  const { context } = s;
  const start = s.t0 + at;
  const end = start + dur;
  const env = envelope(context, start, attack, gain, end);
  let input = env;
  if (drive) {
    const shaper = new WaveShaperNode(context, { curve: driveCurve(drive), oversample: '2x' });
    shaper.connect(input);
    input = shaper;
  }
  if (filter) {
    const tone = new BiquadFilterNode(context, { type: filter.type ?? 'lowpass', frequency: filter.from ?? filter.freq, Q: filter.q ?? 0.7 });
    if (filter.to) {
      tone.frequency.setValueAtTime(filter.from, start);
      tone.frequency.exponentialRampToValueAtTime(filter.to, start + (filter.over ?? dur));
    }
    tone.connect(input);
    input = tone;
  }
  for (const cents of detune) {
    const osc = new OscillatorNode(context, { type, frequency: freq, detune: cents });
    if (glide) {
      osc.frequency.setValueAtTime(freq, start + (glide.at ?? 0));
      osc.frequency.exponentialRampToValueAtTime(glide.to, start + (glide.at ?? 0) + glide.over);
    }
    osc.connect(input);
    osc.start(start);
    osc.stop(end + 0.05);
  }
  route(s, env, sends);
}

function noise(s, { at, dur, gain = 0.1, attack = 0.002, filter = { type: 'highpass', freq: 6000 }, sends }) {
  const { context } = s;
  const start = s.t0 + at;
  const end = start + dur;
  const source = new AudioBufferSourceNode(context, { buffer: sharedBuffers(context).noise, loop: true });
  const tone = new BiquadFilterNode(context, { type: filter.type, frequency: filter.from ?? filter.freq, Q: filter.q ?? 0.8 });
  if (filter.to) {
    tone.frequency.setValueAtTime(filter.from, start);
    tone.frequency.exponentialRampToValueAtTime(filter.to, start + (filter.over ?? dur));
  }
  const env = envelope(context, start, attack, gain, end);
  source.connect(tone).connect(env);
  route(s, env, sends);
  source.start(start, Math.random()); // a different slice of noise each hit
  source.stop(end + 0.05);
}

// fm synthesis, ratio sets the modulator's pitch, index how bright the attack is before it mellows
function fm(s, { at, dur, freq, ratio, index, gain, wobble = 0, sends }) {
  const { context } = s;
  const start = s.t0 + at;
  const end = start + dur;
  const carrier = new OscillatorNode(context, { frequency: freq });
  const modulator = new OscillatorNode(context, { frequency: freq * ratio });
  const depth = new GainNode(context, { gain: freq * index });
  depth.gain.setValueAtTime(freq * index, start);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, freq * index * 0.03), end);
  modulator.connect(depth).connect(carrier.frequency);
  const oscillators = [carrier, modulator];
  if (wobble) {
    // tape wobble, a slow vibrato in cents
    const lfo = new OscillatorNode(context, { frequency: 5.2 });
    lfo.connect(new GainNode(context, { gain: wobble })).connect(carrier.detune);
    oscillators.push(lfo);
  }
  const env = envelope(context, start, 0.004, gain, end);
  carrier.connect(env);
  route(s, env, sends);
  for (const osc of oscillators) {
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

const kick = (s, at, gain = 0.5) => note(s, { at, dur: 0.42, freq: 150, glide: { to: 42, over: 0.11 }, gain, attack: 0.002 });
const hat = (s, at, gain = 0.05) => noise(s, { at, dur: 0.045, gain, filter: { type: 'highpass', freq: 8000 } });
const crash = (s, at, gain = 0.1) => noise(s, { at, dur: 1.5, gain, filter: { type: 'highpass', freq: 5500 }, sends: { reverb: 0.5 } });

function snare(s, at, gain = 0.22, sends = { reverb: 0.6 }) {
  noise(s, { at, dur: 0.2, gain, filter: { type: 'bandpass', freq: 1900, q: 0.8 }, sends });
  note(s, { at, dur: 0.1, freq: 185, type: 'triangle', gain: gain * 0.7 });
}

// styles: each one schedules its tune and says when the station is called out, voice is the recording and its effects (see speak), speech is the browser fallback

const STYLES = {
  // 80s neon: a filtered detuned saw chord swell, a glittering arpeggio, a big gated reverb snare, announcer doubled dark and drenched in reverb
  synthwave(s) {
    for (const midi of [57, 60, 64, 67, 71]) {
      note(s, { at: 0, dur: 2.6, freq: hz(midi), type: 'sawtooth', gain: 0.03, attack: 0.25, detune: [-8, 8], filter: { from: 350, to: 3200, over: 1.4, q: 2 }, sends: { reverb: 0.4 } });
    }
    [69, 72, 76, 79, 81, 84, 88, 91].forEach((midi, i) => note(s, { at: 0.2 + i * 0.1, dur: 0.35, freq: hz(midi), type: 'triangle', gain: 0.06, sends: { echo: 0.5, reverb: 0.2 } }));
    note(s, { at: 1, dur: 1.6, freq: hz(33), type: 'sawtooth', gain: 0.1, filter: { freq: 220 } });
    kick(s, 1);
    snare(s, 1, 0.3, { reverb: 1.2 });
    return {
      voiceAt: 1.05,
      voice: { delivery: 'deep', rate: 0.95, gain: 0.8, filters: [{ type: 'lowpass', freq: 6500 }], double: { level: 0.45, detune: 14, delay: 0.024, pan: 0.45 }, sends: { reverb: 0.9, echo: 0.4 } },
      speech: { pitch: 0.65, rate: 0.8, text: spelled(true) },
    };
  },

  // 8 bit: a square wave arpeggio climbing two octaves, a coin grab and a closing chord, kick under each bass note, host sped up and crushed with a stutter on the first letter
  chiptune(s) {
    [60, 64, 67, 72, 76, 79, 84, 88].forEach((midi, i) => note(s, { at: i * 0.06, dur: 0.08, freq: hz(midi), type: 'square', gain: 0.11 }));
    note(s, { at: 0.5, dur: 0.1, freq: hz(83), type: 'square', gain: 0.1 });
    note(s, { at: 0.6, dur: 0.55, freq: hz(88), type: 'square', gain: 0.1, sends: { echo: 0.3 } });
    for (const midi of [72, 76, 79]) note(s, { at: 1.2, dur: 0.6, freq: hz(midi), type: 'square', gain: 0.06, sends: { echo: 0.3 } });
    for (const at of [0.5, 1.2]) {
      note(s, { at, dur: 0.6, freq: hz(36), type: 'triangle', gain: 0.3 });
      kick(s, at, 0.4);
    }
    return {
      voiceAt: 0.65,
      voice: { delivery: 'bright', rate: 1.15, gain: 0.75, crush: 6, filters: [{ type: 'highpass', freq: 180 }, { type: 'peaking', freq: 2200, q: 1, gain: 4 }], stutter: 1, sends: { echo: 0.25 } },
      speech: { pitch: 1.5, rate: 1.2, text: spelled(false) },
    };
  },

  // brass section: syncopated stabs on an e9 chord over a slap bass, ending on a filter wah, voice gets a slapback and a wah sweeping through it
  funk(s) {
    for (const [at, dur] of [[0, 0.18], [0.25, 0.14], [0.62, 0.9]]) {
      for (const midi of [52, 56, 62, 66]) {
        note(s, { at, dur, freq: hz(midi), type: 'sawtooth', gain: 0.035, attack: 0.012, detune: [-6, 6], filter: { from: 3200, to: dur > 0.5 ? 700 : 2200, over: dur, q: 3 }, sends: { reverb: 0.25 } });
      }
    }
    [[0, 40], [0.375, 40], [0.5, 52], [0.62, 40]].forEach(([at, midi]) => note(s, { at, dur: 0.22, freq: hz(midi), type: 'square', gain: 0.07, filter: { freq: 600 } }));
    kick(s, 0);
    snare(s, 0.25);
    kick(s, 0.5);
    snare(s, 0.62, 0.26);
    [0.125, 0.375, 0.75].forEach((at) => hat(s, at));
    return {
      voiceAt: 0.72,
      voice: { delivery: pick(['cool', 'bright']), gain: 0.6, drive: 1.5, filters: [{ type: 'peaking', from: 600, to: 2600, q: 2.5, gain: 9 }], sends: { echo: 0.25, reverb: 0.2 } },
      speech: { pitch: 0.9, rate: 1, text: spelled(true) },
    };
  },

  // fm radio station id: a noise riser and laser zap into a sub drop, then a bell chime with echoes, announcer on the air with a narrow band, grit and a light echo
  radio(s) {
    noise(s,{ at: 0, dur: 0.8, gain: 0.12, attack: 0.75, filter: { type: 'bandpass', from: 300, to: 7000, over: 0.8, q: 1.2 } });
    note(s, { at: 0.55, dur: 0.3, freq: 2400, glide: { to: 180, over: 0.28 }, gain: 0.08, sends: { echo: 0.4 } });
    kick(s, 0.8, 0.6);
    note(s, { at: 0.8, dur: 1.4, freq: hz(28), gain: 0.28 });
    [84, 88, 91].forEach((midi, i) => fm(s, { at: 0.95 + i * 0.16, dur: 1.6, freq: hz(midi), ratio: 3.5, index: 2.2, gain: 0.08, sends: { reverb: 0.5, echo: 0.4 } }));
    return {
      // right on the sub drop, so the first letter is out before the bells start
      voiceAt: 0.78,
      voice: { delivery: 'deep', gain: 0.6, drive: 2, filters: [{ type: 'highpass', freq: 300 }, { type: 'peaking', freq: 2000, q: 1, gain: 3 }, { type: 'lowpass', freq: 3600 }], sends: { echo: 0.12, reverb: 0.2 } },
      speech: { pitch: 0.5, rate: 0.75, text: spelled(true) },
    };
  },

  // late night: a rolled electric piano chord with tape wobble over a soft bass note, soft voice warm and a little wobbly like it's on the same tape
  lofi(s) {
    [62, 66, 69, 73, 76].forEach((midi, i) => fm(s, { at: i * 0.06, dur: 2.2, freq: hz(midi), ratio: 1, index: 0.9, gain: 0.08, wobble: 7, sends: { reverb: 0.35, echo: 0.15 } }));
    note(s, { at: 0, dur: 2, freq: hz(38), gain: 0.24 });
    return {
      voiceAt: 0.7,
      voice: { delivery: 'soft', rate: 0.98, gain: 0.95, wobble: 8, filters: [{ type: 'lowpass', freq: 5200 }], sends: { reverb: 0.18 } },
      speech: { pitch: 1.05, rate: 0.9, text: spelled(false) },
    };
  },

  // arena rock: a drum fill into a distorted power chord and a crash, voice doubled and distorted like it's shouted through a stack of amps
  rock(s) {
    [0, 0.1, 0.2].forEach((at, i) => snare(s, at, 0.14 + i * 0.06, { reverb: 0.3 }));
    kick(s, 0.3, 0.6);
    crash(s, 0.3);
    for (const midi of [40, 47, 52]) {
      note(s, { at: 0.3, dur: 1.8, freq: hz(midi), type: 'sawtooth', gain: 0.045, detune: [-5, 5], drive: 30, filter: { freq: 2600 }, glide: { to: hz(midi - 2), at: 1.3, over: 0.5 }, sends: { reverb: 0.3 } });
    }
    return {
      voiceAt: 0.45,
      voice: { delivery: pick(['deep', 'cool']), gain: 0.45, drive: 3, filters: [{ type: 'highpass', freq: 140 }, { type: 'peaking', freq: 2500, q: 1, gain: 4 }], double: { level: 0.4, detune: -12, delay: 0.03, pan: 0.5 }, sends: { reverb: 0.75 } },
      speech: { pitch: 0.8, rate: 1.05, text: spelled(true) },
    };
  },
};

export const JINGLE_STYLES = Object.keys(STYLES);

// station voice, recorded for every letter a to z (public/voice), fetched on page load and decoded once per audio context, falls back to speech otherwise

let recordings = null; // a promise of Map, delivery to encoded audio
const decodings = new WeakMap(); // AudioContext to { buffers: Map of AudioBuffers once decoded, done: Promise }

// "É" is recorded as e, digits and other alphabets have no recording
function recordedLetter(letter) {
  const base = letter.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return /^[A-Z]$/.test(base) ? base.toLowerCase() : null;
}

export function loadStationVoice(letter = channel.letter) {
  const recorded = recordedLetter(letter);
  recordings = recorded
    ? Promise.allSettled(DELIVERIES.map(async (delivery) => {
        const res = await fetch(`/voice/${recorded}-${delivery}.mp3`);
        if (!res.ok) throw new Error(`/voice/${recorded}-${delivery}.mp3 answered ${res.status}`);
        return [delivery, await res.arrayBuffer()];
      })).then((results) => new Map(results.filter((result) => result.status === 'fulfilled').map((result) => result.value)))
    : Promise.resolve(new Map());
  return recordings;
}

// decodes the recordings for an audio context, so they're ready by the time a jingle needs them
export function prepareStationVoice(sound = audio()) {
  if (!sound || !recordings) return Promise.resolve(null);
  let decoding = decodings.get(sound.context);
  if (!decoding) {
    decoding = { buffers: null };
    decoding.done = recordings
      .then((files) => Promise.all([...files].map(([delivery, bytes]) => sound.context.decodeAudioData(bytes.slice(0)).then((buffer) => [delivery, buffer], () => null))))
      .then((entries) => (decoding.buffers = new Map(entries.filter(Boolean))));
    decodings.set(sound.context, decoding);
  }
  return decoding.done;
}

// plays a recorded station id through a style's effects: rate is playback speed, filters run in a row or sweep, drive is saturation, crush is bit depth, wobble is tape wobble in cents, double is a second detuned take, stutter repeats a sliver of the first letter
function speak(s, buffer, at, { rate = 1, gain = 0.7, filters = [], drive, crush, wobble, double, stutter = 0, sends }) {
  const { context } = s;
  const start = s.t0 + at;
  const length = buffer.duration / rate;
  const level = new GainNode(context, { gain });
  let input = level;
  for (const filter of [...filters].reverse()) {
    const tone = new BiquadFilterNode(context, { type: filter.type, frequency: filter.from ?? filter.freq, Q: filter.q ?? 0.7, gain: filter.gain ?? 0 });
    if (filter.to) {
      tone.frequency.setValueAtTime(filter.from, start);
      tone.frequency.exponentialRampToValueAtTime(filter.to, start + length);
    }
    tone.connect(input);
    input = tone;
  }
  if (drive) {
    const shaper = new WaveShaperNode(context, { curve: driveCurve(drive), oversample: '2x' });
    shaper.connect(input);
    input = shaper;
  }
  if (crush) {
    const crusher = new WaveShaperNode(context, { curve: crushCurve(crush) });
    crusher.connect(input);
    input = crusher;
  }
  const take = (when, { duration, detune = 0, delay = 0, pan = 0, amount = 1 } = {}) => {
    const source = new AudioBufferSourceNode(context, { buffer, playbackRate: rate, detune });
    const volume = new GainNode(context, { gain: amount });
    source.connect(volume).connect(new StereoPannerNode(context, { pan })).connect(input);
    const begin = when + delay;
    const end = begin + (duration ?? buffer.duration) / rate;
    if (duration) {
      // a sliver, its cut end fades so it doesn't click
      volume.gain.setValueAtTime(amount, end - 0.012);
      volume.gain.linearRampToValueAtTime(0, end);
    }
    if (wobble) {
      const lfo = new OscillatorNode(context, { frequency: 5.3 });
      lfo.connect(new GainNode(context, { gain: wobble })).connect(source.detune);
      lfo.start(begin);
      lfo.stop(end + 0.05);
    }
    source.start(begin, 0, duration);
  };
  const sliver = 0.085;
  for (let i = stutter; i > 0; i--) take(start - i * (sliver / rate + 0.035), { duration: sliver });
  take(start, { pan: double ? -double.pan / 2 : 0 });
  if (double) take(start, { detune: double.detune, delay: double.delay, pan: double.pan, amount: double.level });
  route(s, level, sends);
}

let voices = [];
const loadVoices = () => { voices = speechSynthesis.getVoices().filter((voice) => /^en([-_]|$)/i.test(voice.lang)); };
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

function announce({ text, pitch, rate }) {
  if (!('speechSynthesis' in window) || isMuted()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  if (voices.length) utterance.voice = pick(voices);
  Object.assign(utterance, { pitch, rate, volume: 1 });
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

let lastStyle = null;

// plays a random style, never the same one twice in a row, style and delivery pick them instead, sound lets tests render offline
export function playJingle({ style, delivery, sound = audio() } = {}) {
  if (!sound || isMuted()) return null;
  const name = style ?? pick(JINGLE_STYLES.filter((option) => option !== lastStyle));
  lastStyle = name;
  const s = studio(sound);
  const { voiceAt, voice, speech } = STYLES[name](s);
  const recording = decodings.get(sound.context)?.buffers?.get(delivery ?? voice.delivery);
  if (recording) {
    speak(s, recording, voiceAt, voice);
  } else {
    prepareStationVoice(sound); // ready for the next jingle
    setTimeout(() => announce(speech), Math.max(0, voiceAt * 1000 - VOICE_LATENCY_MS));
  }
  return name;
}

// switching off and booting up, the tune in screen switches off like an old set, then the channel boots with a longer jingle of its own

// when the boot jingle's moments land in seconds from its start, so the boot screen can move with it (boot.js): the hit, the beat length, the voice break, the final chord, and when the screen opens
export const BOOT_TIMING = { hit: 2, beat: 0.4, voice: 5.3, final: 6.3, open: 7.5 };

// a crt set switching off: the relay clacks, the picture collapses in a falling zap over the mains buzz, the flyback whine dies away, static crackles off the glass
export function playSwitchOff({ sound = audio() } = {}) {
  if (!sound || isMuted()) return;
  const s = studio(sound);
  noise(s, { at: 0, dur: 0.035, gain: 0.3, filter: { type: 'bandpass', freq: 2600, q: 1.5 } });
  note(s, { at: 0, dur: 0.18, freq: 120, glide: { to: 38, over: 0.13 }, gain: 0.4, attack: 0.002 });
  note(s, { at: 0.02, dur: 0.45, freq: 1900, glide: { to: 70, over: 0.4 }, gain: 0.1, filter: { freq: 2600 }, sends: { reverb: 0.25 } });
  note(s, { at: 0, dur: 0.32, freq: 60, type: 'sawtooth', gain: 0.07, filter: { type: 'bandpass', freq: 480, q: 2 } });
  note(s, { at: 0, dur: 0.75, freq: 7800, glide: { to: 4600, over: 0.7 }, gain: 0.012 });
  for (let i = 0; i < 9; i++) {
    const at = 0.06 + Math.random() * 0.7;
    noise(s, { at, dur: 0.006 + Math.random() * 0.012, gain: 0.13 * (1 - at), filter: { type: 'highpass', freq: 3000 } });
  }
}

// channel starting up on the first tune in: powers on with a thunk and a degaussing hum, warms up into a big hit, a synth brass tune drops out for the voice then lands on a ringing chord as the first clip comes in, returns the timing used or null without sound
export function playBootJingle({ delivery = pick(['deep', 'bright']), sound = audio() } = {}) {
  if (!sound || isMuted()) return null;
  const s = studio(sound);
  const { hit, beat, voice } = BOOT_TIMING;
  const recording = decodings.get(sound.context)?.buffers?.get(delivery);
  const final = Math.max(BOOT_TIMING.final, voice + (recording ? recording.duration / 0.97 : 0) + 0.1);
  const chord = (at, dur, notes, gain) => notes.forEach((midi) => note(s, {
    at, dur, freq: hz(midi), type: 'sawtooth', gain, attack: 0.01, detune: [-7, 7], filter: { from: 4200, to: 1200, over: dur }, sends: { reverb: 0.3 },
  }));

  // power on: a thunk, the degaussing coil's hum sagging as it settles, and static
  note(s, { at: 0, dur: 0.5, freq: 80, glide: { to: 32, over: 0.3 }, gain: 0.5, attack: 0.003 });
  note(s, { at: 0.02, dur: 1.2, freq: 57, type: 'sawtooth', gain: 0.09, glide: { to: 48, over: 1.1 }, filter: { type: 'bandpass', from: 900, to: 180, q: 3 } });
  noise(s, { at: 0.05, dur: 0.9, gain: 0.05, attack: 0.02, filter: { type: 'highpass', freq: 4000 } });

  // warming up: a noise riser, a climbing sweep, a snare roll into the hit
  noise(s, { at: 0.35, dur: hit - 0.33, gain: 0.12, attack: hit - 0.45, filter: { type: 'bandpass', from: 250, to: 7000, q: 1.2 } });
  note(s, { at: 0.4, dur: hit - 0.38, freq: hz(40), type: 'sawtooth', gain: 0.045, attack: 0.9, detune: [-10, 10], glide: { to: hz(76), over: hit - 0.45 }, filter: { from: 300, to: 5000, q: 2 } });
  [1.2, 1.4, 1.55, 1.7, 1.8, 1.9].forEach((at, i) => snare(s, at, 0.07 + i * 0.03, { reverb: 0.3 }));

  // the hit, then two bars of e, c#m, a and b: bass in eighths, kick on every beat, snare on 2 and 4, a lead on top
  kick(s, hit, 0.7);
  crash(s, hit, 0.14);
  note(s, { at: hit, dur: 0.8, freq: hz(28), gain: 0.3 });
  [[40, [52, 56, 59, 64]], [37, [49, 56, 61, 64]], [33, [45, 52, 57, 61]], [35, [47, 54, 59, 63]]].forEach(([root, notes], bar) => {
    const at = hit + bar * beat * 2;
    chord(at, beat * 2 - 0.02, notes, bar ? 0.022 : 0.03);
    for (let i = 0; i < 4; i++) note(s, { at: at + (i * beat) / 2, dur: beat / 2 - 0.02, freq: hz(root), type: 'square', gain: 0.06, filter: { freq: 520 } });
  });
  for (let b = 1; b < 8; b++) kick(s, hit + b * beat, 0.45);
  for (let b = 1; b < 8; b += 2) snare(s, hit + b * beat, 0.2);
  for (let b = 0; b < 8; b++) hat(s, hit + (b + 0.5) * beat);
  // [half-beat, note, half-beats long]
  const lead = [[0, 76, 1], [1, 80, 1], [2, 83, 2], [4, 80, 1], [5, 85, 2], [7, 83, 1], [8, 81, 1], [9, 85, 2], [11, 88, 1], [12, 87, 1], [13, 83, 3]];
  for (const [step, midi, length] of lead) {
    const at = hit + (step * beat) / 2;
    const dur = (length * beat) / 2 - 0.02;
    note(s, { at, dur, freq: hz(midi), type: 'square', gain: 0.045, attack: 0.008, detune: [-6, 6], filter: { freq: 3400 }, sends: { echo: 0.25, reverb: 0.2 } });
    note(s, { at, dur, freq: hz(midi - 12), type: 'triangle', gain: 0.04 });
  }

  // the break: beat drops out under a sub drop and a swell, the voice calls out the station
  const breakAt = hit + 8 * beat;
  note(s, { at: breakAt, dur: 0.9, freq: 62, glide: { to: 30, over: 0.8 }, gain: 0.3 });
  noise(s, { at: breakAt + 0.25, dur: final - breakAt - 0.23, gain: 0.08, attack: final - breakAt - 0.35, filter: { type: 'bandpass', from: 400, to: 6000, q: 1 } });
  if (recording) {
    speak(s, recording, voice, { rate: 0.97, gain: 0.8, filters: [{ type: 'highpass', freq: 90 }, { type: 'peaking', freq: 2800, q: 1, gain: 3 }], double: { level: 0.35, detune: 10, delay: 0.022, pan: 0.4 }, sends: { reverb: 0.6, echo: 0.3 } });
  } else {
    prepareStationVoice(sound);
    setTimeout(() => announce({ text: spelled(true), pitch: 0.7, rate: 0.85 }), Math.max(0, voice * 1000 - VOICE_LATENCY_MS));
  }

  // the final chord rings out with bells over it
  kick(s, final, 0.7);
  crash(s, final, 0.16);
  chord(final, 1.9, [40, 47, 52, 56, 59, 64], 0.03);
  note(s, { at: final, dur: 1.8, freq: hz(28), gain: 0.3 });
  [88, 92, 95].forEach((midi, i) => fm(s, { at: final + 0.1 + i * 0.12, dur: 1.6, freq: hz(midi), ratio: 3.5, index: 2, gain: 0.06, sends: { reverb: 0.5, echo: 0.3 } }));
  return { ...BOOT_TIMING, final, open: final + BOOT_TIMING.open - BOOT_TIMING.final };
}
