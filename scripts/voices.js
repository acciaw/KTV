// records the station ids the jingles play, every letter a to z in four deliveries with kokoro, checked with whisper, encoded with ffmpeg
//   npm install --no-save kokoro-js
//   node scripts/voices.js
//   node scripts/voices.js --letters KTV
//   node scripts/voices.js --no-check
//   node scripts/voices.js --out some/folder
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const outDir = path.resolve(option('--out') ?? fileURLToPath(new URL('../public/voice/', import.meta.url)));
const letters = [...(option('--letters') ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').toUpperCase()].filter((letter) => /^[A-Z]$/.test(letter));
const check = !args.includes('--no-check');

// jingles ask for deliveries by these names (public/jingles.js), letters joined the way each delivery says them
const DELIVERIES = {
  deep: { voice: 'am_michael', speed: 0.92, between: '. ', end: '.' },
  bright: { voice: 'af_heart', speed: 1.08, between: ' ', end: '!' },
  cool: { voice: 'bm_george', speed: 1, between: ', ', end: '.', british: true },
  soft: { voice: 'af_bella', speed: 0.9, between: '... ', end: '.' },
};
const say = (delivery, words) => words.join(delivery.between) + delivery.end;

// letters spelled the way they're said, "Ay" would come out as "eye", next spelling tried when a take isn't heard right
const SPELLINGS = {
  A: ['A', 'A.'], B: ['Bee', 'B.'], C: ['See', 'C.'], D: ['Dee', 'D.'], E: ['Ee', 'E.'], F: ['Eff', 'F.'],
  G: ['Jee', 'G.'], H: ['Aitch', 'H.'], I: ['Eye', 'I.'], J: ['Jay', 'J.'], K: ['Kay', 'K.'], L: ['Ell', 'L.'],
  M: ['Em', 'M.'], N: ['En', 'N.'], O: ['Oh', 'O.'], P: ['Pee', 'P.'], Q: ['Cue', 'Q.'], R: ['Are', 'R.'],
  S: ['Ess', 'S.'], T: ['Tee', 'T.'], U: ['You', 'U.'], V: ['Vee', 'V.'], W: ['Double-you', 'W.'], X: ['Ex', 'X.'],
  Y: ['Why', 'Y.'], Z: ['Zee', 'Z.'],
};
const BRITISH_SPELLINGS = { Z: ['Zed', 'Z.'] };
const spellingsFor = (delivery, letter) => (delivery.british && BRITISH_SPELLINGS[letter]) || SPELLINGS[letter];

// acronyms everybody knows, one per letter, confirms the voice says the letter right even if the plain spelling was misheard
const ACRONYMS = {
  A: 'ABC', B: 'BBC', C: 'CNN', D: 'DVD', E: 'ESPN', F: 'FBI', G: 'GPS', H: 'HBO', I: 'IBM', J: 'JFK', K: 'KFC', L: 'LOL',
  M: 'MTV', N: 'NBC', O: 'OMG', P: 'PDF', Q: 'QVC', R: 'RPG', S: 'SOS', T: 'TLC', U: 'USA', V: 'VIP', W: 'WWE', X: 'XML',
  Y: 'YMCA', Z: 'ZZ',
};

const MAX_SECONDS = 2.6;
// every take is brought to the same loudness (rms of its voiced part), peaks kept under this
const TARGET_RMS = 0.2;
const PEAK_LIMIT = 0.9;

function resample(samples, from, to) {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    out[i] = samples[j] * (1 - (x - j)) + (samples[j + 1] ?? 0) * (x - j);
  }
  return out;
}

// trims the silence around a take, evens out its loudness, fades its ends
function master(samples, rate) {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const loud = (value) => Math.abs(value) > peak * 0.03;
  const first = Math.max(0, samples.findIndex(loud) - Math.round(rate * 0.015));
  const last = Math.min(samples.length, samples.findLastIndex(loud) + Math.round(rate * 0.12));
  const take = samples.slice(first, last);

  const frame = Math.round(rate * 0.02);
  const energies = [];
  for (let i = 0; i + frame <= take.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += take[j] ** 2;
    energies.push(sum / frame);
  }
  const loudest = Math.max(...energies);
  const voiced = energies.filter((energy) => energy > loudest * 0.1);
  const rms = Math.sqrt(voiced.reduce((sum, energy) => sum + energy, 0) / voiced.length);
  let takePeak = 0;
  for (const value of take) takePeak = Math.max(takePeak, Math.abs(value));
  const gain = Math.min(TARGET_RMS / rms, PEAK_LIMIT / takePeak);

  const fadeIn = Math.round(rate * 0.005);
  const fadeOut = Math.round(rate * 0.04);
  for (let i = 0; i < take.length; i++) take[i] *= gain * Math.min(1, i / fadeIn, (take.length - 1 - i) / fadeOut);
  return take;
}

// 16 bit mono pcm wav
function wav(samples, rate) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  return data;
}

const lettersOnly = (text) => text.toUpperCase().replace(/[^A-Z]/g, '');

// recognizers write a spoken letter as the letter or its spelling, like "KTV" or "Kay TV" or "K. Tee Vee"
function heardRight(heard, letter, spelling) {
  const said = lettersOnly(heard);
  return [letter, lettersOnly(spelling)].some((name) => said === `${name}TV` || said === `${name}TEEVEE`);
}

mkdirSync(outDir, { recursive: true });
const scratch = mkdtempSync(path.join(tmpdir(), 'ktv-voices-'));
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
const listen = check ? await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { dtype: 'q8', device: 'cpu' }) : null;

async function record(delivery, words) {
  const audio = await tts.generate(say(delivery, words), { voice: delivery.voice, speed: delivery.speed });
  return { take: master(audio.audio, audio.sampling_rate), rate: audio.sampling_rate };
}

// what the recognizer writes for a take, with some silence around it to steady it
async function transcribe({ take, rate }) {
  const pad = Math.round(rate * 0.3);
  const padded = new Float32Array(take.length + pad * 2);
  padded.set(take, pad);
  return (await listen(resample(padded, rate, 16000))).text.trim();
}

// acronym that confirms a voice says a letter right, or null if that didn't come out either
const confirmations = new Map();
async function confirmedBy(letter, delivery, spelling) {
  const key = `${letter}|${delivery.voice}|${spelling}`;
  if (!confirmations.has(key)) {
    const acronym = ACRONYMS[letter];
    const words = [...acronym].map((each, i) => (i === 0 ? spelling : spellingsFor(delivery, each)[0]));
    const heard = await transcribe(await record(delivery, words));
    confirmations.set(key, lettersOnly(heard).includes(acronym) ? acronym : null);
  }
  return confirmations.get(key);
}

const doubtful = [];
for (const letter of letters) {
  for (const [name, delivery] of Object.entries(DELIVERIES)) {
    let kept = null;
    for (const spelling of spellingsFor(delivery, letter)) {
      const words = [spelling, SPELLINGS.T[0], SPELLINGS.V[0]];
      const recording = await record(delivery, words);
      const seconds = recording.take.length / recording.rate;
      const heard = listen ? await transcribe(recording) : null;
      const acronym = listen && !heardRight(heard, letter, spelling) ? await confirmedBy(letter, delivery, spelling) : null;
      const good = seconds <= MAX_SECONDS && (!listen || heardRight(heard, letter, spelling) || Boolean(acronym));
      // first spelling is kept unless a later one checks out
      if (good || !kept) kept = { ...recording, line: say(delivery, words), seconds, heard, acronym, good };
      if (good) break;
    }
    const wavPath = path.join(scratch, `${letter}-${name}.wav`);
    writeFileSync(wavPath, wav(kept.take, kept.rate));
    const mp3Path = path.join(outDir, `${letter.toLowerCase()}-${name}.mp3`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '56k', mp3Path]);
    const heardNote = kept.heard === null ? '' : `, heard "${kept.heard}"${kept.acronym ? ` (letter confirmed by ${kept.acronym})` : ''}`;
    console.log(`${letter} ${name.padEnd(6)} "${kept.line}" ${kept.seconds.toFixed(2)} s${heardNote}${kept.good ? '' : '   <- listen to this one'}`);
    if (!kept.good) doubtful.push(`${letter.toLowerCase()}-${name}.mp3`);
  }
}

writeFileSync(path.join(outDir, 'CREDITS.txt'), `Station IDs ("[letter] T V" for every letter from A to Z, in four deliveries), recorded with scripts/voices.js
using Kokoro-82M by hexgrad (https://huggingface.co/hexgrad/Kokoro-82M), Apache License 2.0, through kokoro-js.

Voices: ${Object.entries(DELIVERIES).map(([name, delivery]) => `${delivery.voice} (${name})`).join(', ')}.
`);
rmSync(scratch, { recursive: true, force: true });
console.log(doubtful.length ? `\nNot confirmed: ${doubtful.join(', ')}` : `\nAll ${letters.length * Object.keys(DELIVERIES).length} takes confirmed.`);
