import { bootScreen } from './boot.js';
import { startBug } from './bug.js';
import { clipEnd } from './clip.js';
import { loadStationVoice, playBootJingle, playJingle, playSwitchOff, prepareStationVoice } from './jingles.js';
import { PALETTE, PATTERNS, channel, createLogo, pick, pickColors, setChannel } from './logo.js';
import { hideLowerThird, showLowerThird } from './lowerthird.js';
import { displayNames } from './names.js';
import { initAudio, setMuted } from './sound.js';
import { TRANSITIONS, makeTransition, randomTransition, runNoise } from './transitions.js';

const BUMPER_EVERY = 5; // a full station ident every n clips
const LOAD_TIMEOUT_MS = 15_000;
// youtube's embed player draws a play/pause button in the middle of the picture for a few seconds whenever playback starts, so clip changes keep the transition up until it's faded while the audio fades in underneath
const PLAY_ICON_MS = 4_300; // measured: still visible at 3.5 s after playback starts, gone by 4 s
// on the first tune in, the first clip starts loading this long into the boot screen, ready about when the boot jingle lets the screen open
const BOOT_LOAD_DELAY_MS = 2_500;
const FADE_OUT_SECONDS = 3;
const FAILURES_BEFORE_CARD = 6; // videos in a row that wouldn't play before the technical difficulties card
// asking the server for the next clip fails while it restarts or the network blips, ktv keeps retrying under the transition and only shows the technical difficulties card when the server stays unreachable this long
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const OUTAGE_BEFORE_CARD_MS = 60_000;
// player errors meaning the video itself can't be embedded, those don't get a second try
const UNPLAYABLE = new Set(['yt-2', 'yt-100', 'yt-101', 'yt-150']);

const $ = (selector) => document.querySelector(selector);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  config: { maxClipSeconds: 0, endCutSeconds: 10 },
  player: null,
  current: null,
  upcoming: null,
  nextUp: null,
  requeue: null,
  waiter: null,
  switching: false,
  started: false,
  userMuted: false,
  clips: 0,
  errorStreak: 0,
  queuedSkip: null,
  covers: [],
  titleCards: null,
  meter: null, // the clip on screen and how long it has played, for the listen history
  fadeRaf: 0,
  timers: {},
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// each page load is its own session, the server won't repeat a song within it, reloading starts a new one
const SESSION = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
// names lose their remaster and live tags once here, for everything that shows them: the title card, up next card and tab title
const fetchNext = () => api(`/api/next?session=${SESSION}`).then((item) => ({ ...item, ...displayNames(item) }));

// streak lets the server tell a broken video (skip it forever) from a broken tv (don't blame the videos)
function report(item, reason, streak) {
  api('/api/report', { method: 'POST', body: JSON.stringify({ key: item.key, videoId: item.video.id, reason, streak }) }).catch(() => {});
}

// listen history, how long each clip really plays, sent to the server when it ends (server/history.js)

function startMeter(item) {
  recordPlay('end'); // in case a clip is somehow still on the meter
  state.meter = { item, startedAt: new Date().toISOString(), seconds: 0, videoTime: null, wallTime: performance.now() };
}

// counts playing time on the video's own clock, which keeps running in a background tab where timers slow down
function meterPlayback() {
  const { meter, player } = state;
  if (!meter || !player?.getPlayerState) return;
  const now = performance.now();
  const videoTime = player.getCurrentTime();
  const moved = videoTime - (meter.videoTime ?? videoTime);
  // a jump further than the time that passed is a seek, not listening
  if (player.getPlayerState() === YT.PlayerState.PLAYING && moved > 0 && moved <= (now - meter.wallTime) / 1000 + 1) meter.seconds += moved;
  meter.videoTime = videoTime;
  meter.wallTime = now;
}

// sends the clip that's ending to the listen history, reason is why it ends: end, skip, error, or close when the page closes which needs a beacon to get out in time
function recordPlay(reason, { beacon = false } = {}) {
  meterPlayback();
  const { meter } = state;
  state.meter = null;
  if (!meter || meter.seconds < 1) return;
  const { item } = meter;
  const body = JSON.stringify({
    session: SESSION,
    startedAt: meter.startedAt,
    seconds: Math.round(meter.seconds),
    reason,
    artists: item.artists,
    title: item.title,
    album: item.album,
    year: item.year,
    image: item.image,
    videoId: item.video.id,
    live: Boolean(item.video.live),
    source: item.source,
  });
  if (beacon && navigator.sendBeacon?.('/api/played', new Blob([body], { type: 'application/json' }))) return;
  fetch('/api/played', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

async function fetchNextWithRetry() {
  const since = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchNext();
    } catch (err) {
      console.warn(`Couldn't get the next clip (${err.message}), trying again.`);
      if (Date.now() - since >= OUTAGE_BEFORE_CARD_MS) await technicalDifficulties(err.message);
      else await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }
}

// lines up the clip after the one starting now, a clip that failed for a passing reason gets its second chance here, otherwise the server picks one ahead of time
function queueUpcoming(starting) {
  const retry = state.requeue?.key !== starting.key ? state.requeue : null;
  state.requeue = null;
  state.nextUp = retry;
  state.upcoming = retry
    ? Promise.resolve(retry)
    : fetchNext().then((item) => { state.nextUp = item; return item; }).catch(() => null);
}

function takeUpcoming() {
  const pending = state.upcoming ?? Promise.resolve(null);
  state.upcoming = null;
  return pending.then((item) => item ?? fetchNextWithRetry());
}

// youtube player

function loadYouTubeApi() {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
}

function createPlayer() {
  return new Promise((resolve) => {
    state.player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, origin: location.origin },
      events: { onReady: () => resolve(), onStateChange, onError, onApiChange: hideCaptions },
    });
  });
}

// no player parameter turns captions off, so the captions module is dropped whenever the player loads it or starts a video
function hideCaptions() {
  try {
    state.player.setOption('captions', 'track', {});
    state.player.unloadModule('captions');
  } catch {
    // captions module isn't loaded yet
  }
}

function onStateChange({ data }) {
  const { PLAYING, ENDED } = YT.PlayerState;
  if (data === PLAYING) {
    hideCaptions();
    state.waiter?.done();
  }
  // clips are normally cut before the end (see tick), if a video does reach its end, hide it before youtube's end screen with suggested videos can show
  if (data === ENDED) {
    setStageVisible(false);
    if (!state.waiter) advance('end');
  }
}

function onError({ data }) {
  const reason = `yt-${data}`;
  if (state.waiter) return state.waiter.done(new Error(reason));
  if (state.current) report(state.current, reason, 1);
  advance('error');
}

function playVideo(item) {
  return new Promise((resolve, reject) => {
    const done = (err) => {
      if (state.waiter?.done !== done) return;
      clearTimeout(timer);
      state.waiter = null;
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => done(new Error('timeout')), LOAD_TIMEOUT_MS);
    state.waiter = { done };
    state.player.setVolume(0);
    state.player.loadVideoById({ videoId: item.video.id, startSeconds: item.video.startSeconds ?? 0 });
  });
}

function fadeVolume(to, ms) {
  const player = state.player;
  const from = player.getVolume();
  const start = performance.now();
  cancelAnimationFrame(state.fadeRaf);
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    player.setVolume(Math.round(from + (to - from) * k));
    if (k < 1) state.fadeRaf = requestAnimationFrame(step);
  };
  state.fadeRaf = requestAnimationFrame(step);
}

// programming

async function advance(reason, kind) {
  if (!state.started) return;
  if (state.switching) {
    // skipping through songs on a remote, keep one skip for when the current transition is done
    if (reason === 'skip') state.queuedSkip = { kind };
    return;
  }
  state.switching = true;
  recordPlay(reason);
  hideLowerThird();
  if (reason === 'skip') toast(kind ? `Skip · ${kind}` : 'Skip');
  state.clips++;
  const transition = makeTransition(kind ?? (state.clips % BUMPER_EVERY === 0 ? 'bumper' : randomTransition()));
  playJingle();
  try {
    fadeVolume(0, 400);
    if (transition.hidesBug) setBugVisible(false);
    // a broken transition must not take the channel down, worst case is a plain cut
    await transition.cover().catch((err) => console.error('Transition cover failed:', err));
    clearEndscreenCovers();
    await loadNextPlayable();
    await transition.reveal().catch((err) => {
      console.error('Transition reveal failed:', err);
      $('#transition').replaceChildren();
    });
  } finally {
    setBugVisible(true);
    state.switching = false;
  }
  const queued = state.queuedSkip;
  state.queuedSkip = null;
  if (queued) advance('skip', queued.kind);
}

// fadeIn: false leaves the sound down for the caller to bring up, the boot screen does as it opens
async function loadNextPlayable({ fadeIn = true } = {}) {
  for (;;) {
    const item = await takeUpcoming();
    try {
      await playVideo(item);
      setStageVisible(true); // still under the transition
      state.errorStreak = 0;
      onClipStarted(item, { fadeIn });
      await wait(PLAY_ICON_MS);
      return;
    } catch (err) {
      state.errorStreak++;
      console.warn(`Skipping ${item.artists[0]} - ${item.title}: ${err.message}`);
      report(item, err.message, state.errorStreak);
      if (!UNPLAYABLE.has(err.message) && !item.retried) state.requeue = { ...item, retried: true };
      if (state.errorStreak % FAILURES_BEFORE_CARD === 0) {
        await technicalDifficulties(`YouTube refused ${state.errorStreak} videos in a row (${err.message}). See "Videos won't play" in the README.`);
      }
    }
  }
}

function onClipStarted(item, { fadeIn = true } = {}) {
  state.current = item;
  startMeter(item);
  state.titleCards = null;
  clearEndscreenCovers();
  if (state.player.isMuted() && !state.userMuted) state.player.unMute();
  if (fadeIn) fadeVolume(100, 1500);
  queueUpcoming(item);
  document.title = `${channel.letter}TV · ${item.artists[0]} – ${item.title}`;
}

// when the title card shows during a clip: a few seconds after the picture appears, every minute or so, and near the end, never within 40 seconds of the previous one
function planTitleCards(start, end) {
  const first = start + PLAY_ICON_MS / 1000 + 3;
  const last = end - 25;
  const times = [first];
  for (let t = first + 55 + Math.random() * 30; t < last - 40; t += 55 + Math.random() * 35) times.push(t);
  if (last - first > 40) times.push(last);
  return times;
}

function tick() {
  meterPlayback();
  const { player, current } = state;
  if (!current || state.switching || !player?.getPlayerState) return;
  if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;
  const duration = player.getDuration();
  if (!duration) return;
  const now = player.getCurrentTime();
  const start = current.video.startSeconds ?? 0;
  const { maxClipSeconds, endCutSeconds } = state.config;
  // cut before youtube's end screen: endCutSeconds before the end, or just before its first thumbnail when that's known
  const end = clipEnd({ duration, start, endCutSeconds, maxClipSeconds, endscreen: current.video.endscreen ?? [] });
  const remaining = end - now;

  updateEndscreenCovers(now);

  state.titleCards ??= planTitleCards(start, end);
  if (state.titleCards.length && now >= state.titleCards[0]) {
    while (state.titleCards.length && now >= state.titleCards[0]) state.titleCards.shift();
    showLowerThird(current);
  }

  if (remaining < FADE_OUT_SECONDS) player.setVolume(Math.max(0, Math.round((remaining / FADE_OUT_SECONDS) * 100)));
  if (remaining < 0.6) advance('end');
}

// end screen covers

// where youtube draws the picture, tv.css makes the player taller than the screen and youtube letterboxes the video inside it, so the picture is the largest box of the video's shape that fits the player, centered
function pictureRect(aspectRatio) {
  const box = $('#stage iframe').getBoundingClientRect();
  const width = Math.min(box.width, box.height * aspectRatio);
  const height = width / aspectRatio;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

function textLine(text, className) {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  return line;
}

// uploaders place clickable watch next thumbnails over their video's last seconds, the server knows where and when so ktv puts its own card over each one: what's up next, or the channel logo
function createCover(element) {
  const cover = document.createElement('div');
  const round = element.style === 'CHANNEL';
  cover.className = round ? 'es-cover round' : 'es-cover';
  const next = state.nextUp;
  const showNext = !round && next && !state.covers.some((other) => other?.dataset.next);
  if (showNext) {
    cover.dataset.next = 'true';
    if (next.image) cover.style.backgroundImage = `url(${JSON.stringify(next.image)})`;
    const label = document.createElement('div');
    label.className = 'es-label';
    label.append(textLine('Up next', 'es-kicker'), textLine(next.artists.join(', '), 'es-artist'), textLine(next.title, 'es-title'));
    cover.append(label);
  } else {
    const background = pick(PALETTE);
    cover.style.backgroundColor = background;
    cover.append(createLogo({ pattern: pick(PATTERNS), colors: pickColors([background]) }));
  }
  $('#endscreen-covers').append(cover);
  return cover;
}

function updateEndscreenCovers(now) {
  const video = state.current?.video;
  if (!video?.endscreen?.length) return;
  const picture = pictureRect(video.aspectRatio || 16 / 9);
  video.endscreen.forEach((element, i) => {
    // a little early and a little late, so youtube's own fade never peeks out
    const showing = now >= element.startMs / 1000 - 0.5 && now < element.endMs / 1000 + 0.5;
    if (!showing) {
      state.covers[i]?.remove();
      state.covers[i] = null;
      return;
    }
    state.covers[i] ??= createCover(element);
    const width = element.width * picture.width;
    Object.assign(state.covers[i].style, {
      left: `${picture.left + element.left * picture.width}px`,
      top: `${picture.top + element.top * picture.height}px`,
      width: `${width}px`,
      height: `${width / element.aspectRatio}px`,
    });
  });
}

function clearEndscreenCovers() {
  $('#endscreen-covers').replaceChildren();
  state.covers = [];
}

// on screen graphics

const setBugVisible = (visible) => $('#bug').classList.toggle('off', !visible);
const setStageVisible = (visible) => $('#stage').classList.toggle('off', !visible);

async function technicalDifficulties(message) {
  const card = $('#difficulties');
  card.querySelector('small').textContent = message ?? '';
  card.hidden = false;
  await wait(10_000);
  card.hidden = true;
}

function toast(text) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('on');
  clearTimeout(state.timers.toast);
  state.timers.toast = setTimeout(() => node.classList.remove('on'), 1200);
}

// controls

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {
    // not supported or not allowed, the tv may dim
  }
}

const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else enterFullscreen();
}

function toggleMute() {
  const player = state.player;
  state.userMuted = !player.isMuted();
  state.userMuted ? player.mute() : player.unMute();
  setMuted(state.userMuted);
  toast(state.userMuted ? 'Mute' : 'Sound on');
}

// a manual pause leaves youtube's own pause button visible, only automatic clip changes hide it
function togglePause() {
  if (state.switching) return;
  const player = state.player;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    player.pauseVideo();
    toast('Pause');
  } else {
    player.playVideo();
  }
}

function onKey(event) {
  // escape only ever leaves fullscreen, it doesn't tune in
  if (event.key === 'Escape') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    return;
  }
  if (!state.started) return tuneIn();
  switch (event.key) {
    case 'ArrowRight':
    case 'n':
    case 'MediaTrackNext':
      advance('skip');
      break;
    case 'm':
      toggleMute();
      break;
    case 'f':
      toggleFullscreen();
      break;
    case 'i':
    case 'Enter':
      if (state.current) showLowerThird(state.current);
      break;
    case ' ':
    case 'MediaPlayPause':
      event.preventDefault();
      togglePause();
      break;
    default: {
      // 1-9 skip using a specific transition, to preview them
      const kind = /^[1-9]$/.test(event.key) ? TRANSITIONS[Number(event.key) - 1] : null;
      if (kind) advance('skip', kind);
    }
  }
}

// the tune in screen switches off like an old set, flares, squashes into a bright line and shrinks to a dot that fades from the glass
async function switchOffTuneIn() {
  const screen = $('#tune-in');
  await screen.animate(
    [
      { transform: 'scale(1, 1)', filter: 'brightness(1)' },
      { transform: 'scale(1.02, 1.04)', filter: 'brightness(1.8)', offset: 0.12 },
      { transform: 'scale(1, 0.006)', filter: 'brightness(5)', offset: 0.55 },
      { transform: 'scale(0.004, 0.006)', filter: 'brightness(6)' },
    ],
    { duration: 520, easing: 'ease-in', fill: 'forwards' },
  ).finished;
  const dot = document.createElement('div');
  dot.className = 'crt-dot';
  document.body.append(dot);
  screen.remove();
  stopTuneNoise();
  await dot.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.85, transform: 'scale(0.7)', offset: 0.3 }, { opacity: 0, transform: 'scale(0.15)' }],
    { duration: 700, easing: 'ease-out', fill: 'forwards' },
  ).finished;
  dot.remove();
}

// the first tune in boots the channel: the tune in screen switches off, the set powers back on onto the boot screen and its jingle, the first clip loads underneath, its sound comes up as the screen opens
async function tuneIn() {
  if (state.started) return;
  state.started = true;
  // these need the user gesture, so they run before any await
  toggleFullscreen();
  initAudio();
  prepareStationVoice(); // decoded well before the boot jingle calls out the station
  keepAwake();
  playSwitchOff();
  document.body.classList.add('on-air');

  const boot = bootScreen();
  setBugVisible(false);
  state.switching = true;
  try {
    await switchOffTuneIn();
    await boot.cover(playBootJingle());
    await Promise.all([playerReady, wait(BOOT_LOAD_DELAY_MS)]);
    await loadNextPlayable({ fadeIn: false });
    await boot.untilOpen();
    fadeVolume(100, 1500);
    await boot.reveal();
  } finally {
    setBugVisible(true);
    state.switching = false;
  }
}

// boot

state.config = { ...state.config, ...(await api('/api/config').catch(() => ({}))) };
if (state.config.channel) setChannel(state.config.channel);
loadStationVoice();
document.title = `${channel.letter}TV · ${channel.name} Television`;
$('.tune-in-tagline').textContent = `${channel.name} Television`;

$('#tune-in-logo').replaceChildren(createLogo({ pattern: pick(PATTERNS), colors: pickColors() }));
$('#difficulties-logo').replaceChildren(createLogo());
startBug($('#bug'));
const stopTuneNoise = runNoise($('#tune-noise'));
const playerReady = loadYouTubeApi().then(createPlayer);
// first clip is looked up while the tune in screen waits for a key, so the channel opens without a delay
state.upcoming = fetchNext().catch(() => null);

// youtube refuses most music videos on pages opened by ip address, suggest a hostname that points to the same ip
const openedByIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname);
if (openedByIp) {
  const port = location.port ? `:${location.port}` : '';
  $('#tune-in-hint').textContent =
    `Opened by IP address, so YouTube will refuse most music videos. Use a hostname instead, e.g. ${location.protocol}//${location.hostname.replaceAll('.', '-')}.sslip.io${port}/tv`;
}

api('/api/status')
  .then((status) => {
    const connected = status.spotify?.connected || Object.values(status.services ?? {}).some((service) => service.connected);
    if (!connected && !openedByIp) $('#tune-in-hint').textContent = 'Demo lineup · connect a music service at /admin';
  })
  .catch(() => {});

setInterval(tick, 250);
document.addEventListener('keydown', onKey);
// a click tunes in, goes back to fullscreen after escape left it, or else shows the title card
document.addEventListener('click', () => {
  if (!state.started) return tuneIn();
  if (!document.fullscreenElement && document.fullscreenEnabled) return enterFullscreen();
  if (state.current) showLowerThird(state.current);
});
window.addEventListener('pagehide', () => recordPlay('close', { beacon: true }));
document.addEventListener('visibilitychange', () => {
  if (state.started && document.visibilityState === 'visible') keepAwake();
});
