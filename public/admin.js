import { PATTERNS, createLogo, initialOf, pick, pickColors, setChannel, styleLogo } from './logo.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SAVED_SECRET = '•••••••••••••••• saved, type to replace';

// music services besides spotify, in the order they're listed, and what each can add to the lineup
const SERVICE_ORDER = ['youtube', 'applemusic', 'deezer', 'lastfm'];
const SERVICES = {
  youtube: { name: 'YouTube', switches: [['liked', 'Liked videos (the ones YouTube files under Music)']], playlists: true },
  applemusic: { name: 'Apple Music', switches: [['library', 'Songs in your library']], playlists: true },
  deezer: { name: 'Deezer', switches: [['favorites', 'Favourite tracks']], playlists: true },
  lastfm: { name: 'Last.fm', switches: [['loved', 'Loved tracks'], ['top', 'Top tracks (last 6 months)']], playlists: false },
};
const SOURCE_NAMES = {
  'youtube-liked': 'YouTube likes',
  'youtube-playlist': 'YouTube playlists',
  'applemusic-library': 'Apple Music library',
  'applemusic-playlist': 'Apple Music playlists',
  'deezer-favorites': 'Deezer favourites',
  'deezer-playlist': 'Deezer playlists',
  'lastfm-loved': 'Last.fm loved',
  'lastfm-top': 'Last.fm top',
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function showError(form, message) {
  const box = $('.error', form);
  box.textContent = message ?? '';
  box.hidden = !message;
}

function setStatus(form, message) {
  const box = $('.status', form);
  if (box) box.textContent = message;
}

// runs a form's request with its buttons disabled, shows any error in the form
async function submitting(form, task) {
  showError(form, '');
  const buttons = $$('button', form);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await task();
  } catch (err) {
    showError(form, err.message);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// shared pieces

function renderBrand(name) {
  const channelName = name?.trim() || 'Acciaw';
  setChannel({ name: channelName, letter: initialOf(channelName) });
  $('#logo').replaceChildren(createLogo({ pattern: 'stripes', colors: ['#00e5ff', '#ffe600', '#ff2d95'] }));
  $('#kicker').textContent = `${channelName} Television`;
}

// studio: the masthead's logo and on-air sign, the rundown's tally lights and clock

// masthead logo flips to a new pattern every few seconds, like the corner logo on the tv
function startLogoLoop() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(async () => {
    const logo = $('#logo .ktv-logo');
    if (!logo || document.hidden) return;
    await logo.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], { duration: 180, easing: 'ease-in' }).finished;
    styleLogo(logo, { pattern: pick(PATTERNS), colors: pickColors() });
    logo.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }], { duration: 240, easing: 'ease-out' });
  }, 5000);
}

function setOnAir(live) {
  const sign = $('#on-air');
  sign.dataset.live = String(live);
  $('.on-air-text', sign).textContent = live ? 'On air' : 'Off air';
}

// on air once the channel has music to play, each rundown light is on, on standby, or off
function updateTally(status) {
  const light = (name, state) => { $(`[data-tally="${name}"]`).dataset.state = state; };
  const services = SERVICE_ORDER.map((id) => status.services[id]);
  light('spotify', status.spotify.connected ? 'on' : status.spotify.configured ? 'standby' : 'off');
  light('services', services.some((service) => service.connected) ? 'on' : services.some((service) => service.configured) ? 'standby' : 'off');
  light('keys', status.keys.lastfm || status.keys.youtube ? 'on' : 'off');
  light('lineup', status.library ? 'on' : 'off');
  setOnAir(status.onboarded && anyServiceConnected(status));
}

function startStudioClock() {
  const clock = $('#studio-clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); };
  tick();
  setInterval(tick, 1000);
}

// masthead's tabs between the control room and the stats page, once the channel is set up
function showAdminNav(page) {
  const nav = $('#masthead-nav');
  nav.hidden = false;
  for (const link of $$('a', nav)) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function renderRedirectUri(uri) {
  for (const code of $$('.redirect-uri')) code.textContent = uri;
  for (const button of $$('.copy-uri')) {
    button.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(uri).catch(() => {});
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    });
  }
}

// saved secrets never come back from the server, the field stays empty and only says one is saved
function describeSecret(input, saved, emptyText = '') {
  input.value = '';
  input.placeholder = saved ? SAVED_SECRET : emptyText;
}

const readSpotify = (form) => ({ clientId: form.elements.clientId.value, clientSecret: form.elements.clientSecret.value });

function renderPlaylists(form, playlists, selected) {
  const box = $('.playlists', form);
  if (!playlists.length) {
    box.textContent = 'No playlists on this Spotify account.';
    return;
  }
  box.replaceChildren(...playlists.map((p) => {
    const label = document.createElement('label');
    label.className = `playlist${p.readable ? '' : ' locked'}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'playlist';
    input.value = p.id;
    input.checked = selected.includes(p.id);
    input.disabled = !p.readable;

    const art = document.createElement(p.image ? 'img' : 'span');
    art.className = p.image ? '' : 'ph';
    if (p.image) { art.src = p.image; art.alt = ''; art.loading = 'lazy'; }

    const text = document.createElement('span');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = p.readable
      ? `${p.total ?? '?'} tracks · ${p.owner}`
      : `by ${p.owner} · Spotify only lets apps read playlists you own or collaborate on`;
    text.append(p.name, meta);

    label.append(input, art, text);
    return label;
  }));
}

async function loadPlaylists(form, selected) {
  try {
    renderPlaylists(form, await api('/api/playlists'), selected);
  } catch (err) {
    $('.playlists', form).textContent = `Couldn't load playlists: ${err.message}`;
  }
}

// the onboarding's lineup step has no live or discovery controls, the control room's has both
function fillLineup(form, lineup) {
  form.elements.includeLiked.checked = lineup.includeLiked;
  form.elements.includeTop.checked = lineup.includeTop;
  if (form.elements.includeLive) form.elements.includeLive.checked = lineup.includeLive;
}

function readLineup(form) {
  const lineup = {
    includeLiked: form.elements.includeLiked.checked,
    includeTop: form.elements.includeTop.checked,
    playlists: $$('input[name="playlist"]:checked', form).map((input) => input.value),
  };
  if (form.elements.includeLive) lineup.includeLive = form.elements.includeLive.checked;
  if (form.elements.discoveryShare) lineup.discoveryShare = Number(form.elements.discoveryShare.value);
  return lineup;
}

// other music services

let formCount = 0;

// a service's setup form, cloned from its template, with each label tied to its field
function serviceForm(id) {
  const form = $(`#service-${id}`).content.firstElementChild.cloneNode(true);
  formCount++;
  for (const label of $$('label[data-for]', form)) {
    const input = form.elements[label.dataset.for];
    input.id = `service-${id}-${formCount}-${label.dataset.for}`;
    label.htmlFor = input.id;
  }
  return form;
}

const SERVICE_STATES = {
  youtube: (s) => (s.connected ? 'Connected. Your likes and playlists are read only when the lineup is rebuilt.'
    : "The app is saved, but your account isn't connected yet. Reconnect to finish."),
  applemusic: (s) => (s.connected ? 'Connected to your Apple Music library.' : 'The key is saved. Sign in with Apple Music to finish.'),
  deezer: (s) => `Reading the public profile of ${s.name || s.userId}.`,
  lastfm: (s) => (s.connected ? `Reading the loved and top tracks of ${s.username}.` : 'Add a Last.fm API key to finish.'),
};

function fillServiceForm(form, id, status) {
  const service = status.services[id];
  const state = $('.service-state', form);
  state.hidden = !service.configured;
  if (service.configured) state.textContent = SERVICE_STATES[id](service);
  const fields = form.elements;
  if (id === 'youtube') {
    fields.clientId.value = service.clientId;
    describeSecret(fields.clientSecret, service.secretSaved);
    $('.service-uri', form).textContent = service.redirectUri;
  } else if (id === 'applemusic') {
    fields.teamId.value = service.teamId;
    fields.keyId.value = service.keyId;
    describeSecret(fields.privateKey, service.keySaved);
  } else if (id === 'deezer') {
    fields.profile.value = service.userId ? `https://www.deezer.com/profile/${service.userId}` : '';
  } else {
    fields.username.value = service.username;
    describeSecret(fields.apiKey, service.keySaved);
  }
  const reconnect = $('[data-action="reconnect"]', form);
  if (reconnect) reconnect.hidden = !service.configured;
  $('[data-action="remove"]', form).hidden = !service.configured;
}

// signs in with apple music through apple's musickit, which opens apple's sign in window, hands the result to ktv
async function signInAppleMusic() {
  const { developerToken } = await api('/api/services/applemusic/developer-token');
  if (!window.MusicKit) {
    await new Promise((resolve, reject) => {
      document.addEventListener('musickitloaded', resolve, { once: true });
      const script = document.createElement('script');
      script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      script.async = true;
      script.onerror = () => reject(new Error("Apple's MusicKit didn't load. Check the connection and try again."));
      document.head.append(script);
    });
  }
  const music = await window.MusicKit.configure({ developerToken, app: { name: 'KTV', build: '1.0.0' } });
  const musicUserToken = await music.authorize();
  await api('/api/services/applemusic/connect', { method: 'POST', body: JSON.stringify({ musicUserToken }) });
}

// wires a service's form, changed(status) runs with a fresh status after a change took effect
function bindServiceForm(form, id, changed) {
  const fields = form.elements;
  const after = async (message) => {
    const status = await api('/api/status');
    fillServiceForm(form, id, status);
    setStatus(form, message);
    await changed(status);
  };
  $('.copy-service-uri', form)?.addEventListener('click', async (event) => {
    await navigator.clipboard?.writeText($('.service-uri', form).textContent).catch(() => {});
    event.target.textContent = 'Copied';
    setTimeout(() => { event.target.textContent = 'Copy'; }, 1500);
  });
  const save = {
    youtube: async () => {
      await api('/api/services/youtube', { method: 'PUT', body: JSON.stringify({ clientId: fields.clientId.value, clientSecret: fields.clientSecret.value }) });
      location.href = '/auth/youtube/login';
    },
    applemusic: async () => {
      await api('/api/services/applemusic', { method: 'PUT', body: JSON.stringify({ teamId: fields.teamId.value, keyId: fields.keyId.value, privateKey: fields.privateKey.value }) });
      await signInAppleMusic();
      await after('Connected.');
    },
    deezer: async () => {
      await api('/api/services/deezer', { method: 'PUT', body: JSON.stringify({ profile: fields.profile.value }) });
      await after('Saved.');
    },
    lastfm: async () => {
      const key = fields.apiKey.value.trim();
      if (key) await api('/api/keys', { method: 'PUT', body: JSON.stringify({ lastfm: key }) });
      await api('/api/services/lastfm', { method: 'PUT', body: JSON.stringify({ username: fields.username.value }) });
      await after('Saved.');
    },
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(form, save[id]);
  });
  $('[data-action="reconnect"]', form)?.addEventListener('click', () => submitting(form, async () => {
    if (id === 'youtube') {
      location.href = '/auth/youtube/login';
      return;
    }
    await signInAppleMusic();
    await after('Connected.');
  }));
  $('[data-action="remove"]', form).addEventListener('click', () => {
    if (!confirm(`Remove ${SERVICES[id].name} from KTV? Its songs leave the lineup when it's rebuilt.`)) return;
    submitting(form, async () => {
      await api(`/api/services/${id}`, { method: 'DELETE' });
      await after('Removed.');
    });
  });
}

async function loadServicePlaylists(id, box, selected) {
  try {
    const playlists = await api(`/api/services/${id}/playlists`);
    box.dataset.loaded = 'true';
    if (!playlists.length) {
      box.textContent = `No playlists on this ${SERVICES[id].name} account.`;
      return;
    }
    box.replaceChildren(...playlists.map((p) => {
      const label = element('label', 'playlist');
      const input = element('input');
      input.type = 'checkbox';
      input.dataset.playlist = p.id;
      input.checked = selected.includes(p.id);
      const art = element(p.image ? 'img' : 'span', p.image ? '' : 'ph');
      if (p.image) { art.src = p.image; art.alt = ''; art.loading = 'lazy'; }
      const text = element('span');
      text.append(p.name, element('span', 'meta', [p.total == null ? '' : `${p.total} tracks`, p.owner].filter(Boolean).join(' · ')));
      label.append(input, art, text);
      return label;
    }));
  } catch (err) {
    box.textContent = `Couldn't load playlists: ${err.message}`;
  }
}

// switches and playlists of every connected service besides spotify, under spotify's own sections
function renderServiceLineups(form, status, lineup) {
  const connected = SERVICE_ORDER.filter((id) => status.services[id].connected);
  $('.service-lineups', form).replaceChildren(...connected.map((id) => {
    const saved = lineup.services[id];
    const fieldset = element('fieldset', 'service-lineup');
    fieldset.dataset.service = id;
    fieldset.append(element('legend', '', SERVICES[id].name));
    for (const [name, text] of SERVICES[id].switches) {
      const label = element('label');
      const input = element('input');
      input.type = 'checkbox';
      input.dataset.switch = name;
      input.checked = Boolean(saved[name]);
      label.append(input, ` ${text}`);
      fieldset.append(label);
    }
    if (SERVICES[id].playlists) {
      const box = element('div', 'playlists', 'Loading playlists…');
      fieldset.append(box);
      loadServicePlaylists(id, box, saved.playlists);
    }
    return fieldset;
  }));
  // spotify's sections show while spotify is set up, or while nothing else is, next to other services they say whose
  const showSpotify = status.spotify.configured || !connected.length;
  for (const fieldset of $$('.spotify-only', form)) fieldset.hidden = !showSpotify;
  for (const legend of $$('.spotify-only legend', form)) legend.textContent = connected.length ? legend.dataset.withOthers : legend.dataset.alone;
}

function readServiceLineups(form) {
  return Object.fromEntries($$('.service-lineup', form).map((fieldset) => {
    const lineup = Object.fromEntries($$('input[data-switch]', fieldset).map((input) => [input.dataset.switch, input.checked]));
    const box = $('.playlists', fieldset);
    // playlists that didn't load are left as they were saved
    if (box?.dataset.loaded) lineup.playlists = $$('input[data-playlist]:checked', box).map((input) => input.dataset.playlist);
    return [fieldset.dataset.service, lineup];
  }));
}

function pickedSources(form) {
  const spotifyShown = !$('.spotify-only', form).hidden;
  const spotify = spotifyShown && (form.elements.includeLiked.checked || form.elements.includeTop.checked || $$('input[name="playlist"]:checked', form).length > 0);
  const others = Object.values(readServiceLineups(form)).some((lineup) => Object.values(lineup).some((value) => (Array.isArray(value) ? value.length : value)));
  return spotify || others;
}

// lineup filters: eras and artists

const decadeName = (decade) => (decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`);
const slider = { decades: [], counts: new Map(), overview: null };
const eraPosition = (index) => (slider.decades.length > 1 ? (index / (slider.decades.length - 1)) * 100 : 50);

function bindEras(form) {
  const { eraFrom, eraTo } = form.elements;
  eraFrom.addEventListener('input', () => drawEras(form, eraFrom));
  eraTo.addEventListener('input', () => drawEras(form, eraTo));
}

// slider runs from the decade of the lineup's earliest known song to the decade of its latest
function setupEras(form, overview, saved) {
  const { eraFrom: from, eraTo: to } = form.elements;
  slider.overview = overview;
  slider.decades = [];
  if (!overview?.decades.length) {
    from.disabled = true;
    to.disabled = true;
    $('.era-ticks', form).replaceChildren();
    $('.era-note', form).textContent = overview ? "No song's year is known yet. Years come in as songs air." : 'Build the lineup to choose eras.';
    return;
  }
  const first = overview.decades[0].decade;
  const last = overview.decades.at(-1).decade;
  for (let decade = first; decade <= last; decade += 10) slider.decades.push(decade);
  slider.counts = new Map(overview.decades.map(({ decade, songs }) => [decade, songs]));
  const end = slider.decades.length - 1;
  const index = (decade, fallback) => (decade === null ? fallback : Math.min(end, Math.max(0, (decade - first) / 10)));
  from.max = String(end);
  to.max = String(end);
  from.value = String(index(saved.from, 0));
  to.value = String(index(saved.to, end));
  from.disabled = end === 0;
  to.disabled = end === 0;
  $('.era-ticks', form).style.setProperty('--gaps', String(end || 1));
  $('.era-ticks', form).replaceChildren(...slider.decades.map((decade, i) => {
    const tick = element('span', '', decadeName(decade));
    tick.style.left = `${eraPosition(i)}%`;
    return tick;
  }));
  drawEras(form, from);
}

function drawEras(form, moved) {
  const { eraFrom: from, eraTo: to } = form.elements;
  const { decades, counts, overview } = slider;
  if (!decades.length) return;
  if (Number(from.value) > Number(to.value)) (moved === from ? to : from).value = moved.value;
  const [a, b] = [Number(from.value), Number(to.value)];
  const end = decades.length - 1;
  const fill = $('.era-fill', form);
  fill.style.left = `${eraPosition(a)}%`;
  fill.style.right = `${100 - eraPosition(b)}%`;
  // handles on the same decade can always be pulled apart, on the last decade "from" goes on top
  from.style.zIndex = a === end ? '2' : '1';
  const range = a === b ? `the ${decadeName(decades[a])}` : `${decadeName(decades[a])} to ${decadeName(decades[b])}`;
  const note = $('.era-note', form);
  if (a === 0 && b === end) {
    note.textContent = `All eras: ${range}.`;
    return;
  }
  const songs = decades.slice(a, b + 1).reduce((sum, decade) => sum + (counts.get(decade) ?? 0), 0);
  const unknown = overview.unknownYear ? ` ${overview.unknownYear} more without a known year get checked when they come up.` : '';
  note.textContent = `Only ${range}: ${songs} of ${overview.songs} songs.${unknown}`;
}

// ends of the slider stay open, so songs from decades beyond them that join the lineup later aren't cut out
function readEras(form) {
  const { decades } = slider;
  if (!decades.length) return undefined;
  const [a, b] = [Number(form.elements.eraFrom.value), Number(form.elements.eraTo.value)];
  return { from: a === 0 ? null : decades[a], to: b === decades.length - 1 ? null : decades[b] };
}

const artistsSeen = { excluded: [], listed: new Set() };

function bindArtists(form) {
  const toggle = $('#artists-toggle', form);
  const menu = $('#artists-menu', form);
  const boxes = () => $$('.artist-list input', menu);
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) $('.artists-search', menu).focus();
  });
  $('.artists-search', menu).addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    for (const box of boxes()) box.closest('label').hidden = Boolean(query) && !box.value.toLowerCase().includes(query);
  });
  for (const button of $$('[data-artists]', menu)) {
    button.addEventListener('click', () => {
      for (const box of boxes()) {
        if (!box.closest('label').hidden) box.checked = button.dataset.artists === 'check';
      }
      summarizeArtists(form);
    });
  }
  $('.artist-list', menu).addEventListener('change', () => summarizeArtists(form));
}

function setupArtists(form, overview, excluded) {
  const list = $('.artist-list', form);
  const artists = overview?.artists ?? [];
  artistsSeen.excluded = excluded;
  artistsSeen.listed = new Set(artists.map(({ name }) => name.toLowerCase()));
  $('#artists-toggle', form).disabled = !artists.length;
  if (!artists.length) {
    list.replaceChildren();
    $('.artists-summary', form).textContent = 'Build the lineup to choose artists.';
    return;
  }
  const off = new Set(excluded.map((name) => name.toLowerCase()));
  list.replaceChildren(...artists.map(({ name, songs }) => {
    const label = element('label');
    const box = element('input');
    box.type = 'checkbox';
    box.value = name;
    box.checked = !off.has(name.toLowerCase());
    label.title = `${name}: ${songs} song${songs === 1 ? '' : 's'}`;
    label.append(box, element('span', 'name', name), element('span', 'count', String(songs)));
    return label;
  }));
  summarizeArtists(form);
}

function summarizeArtists(form) {
  const boxes = $$('.artist-list input', form);
  const checked = boxes.filter((box) => box.checked).length;
  $('.artists-summary', form).textContent = checked === boxes.length ? `All ${boxes.length} artists` : `${checked} of ${boxes.length} artists`;
}

// unchecked artists, plus the ones unchecked earlier that aren't in the lineup right now, for when they're back
function readArtists(form) {
  const boxes = $$('.artist-list input', form);
  if (!boxes.length) return undefined;
  const unchecked = boxes.filter((box) => !box.checked).map((box) => box.value);
  const away = artistsSeen.excluded.filter((name) => !artistsSeen.listed.has(name.toLowerCase()));
  return { noneChecked: unchecked.length === boxes.length, excluded: [...away, ...unchecked] };
}

// onboarding

const STEPS = ['1', '2', '3', 'done'];
const anyServiceConnected = (status) => (status.spotify.configured && status.spotify.connected) || SERVICE_ORDER.some((id) => status.services[id].connected);

function showStep(step) {
  const current = STEPS.indexOf(String(step));
  for (const slide of $$('#onboarding [data-step]')) slide.hidden = slide.dataset.step !== String(step);
  for (const item of $$('.steps li')) {
    const position = STEPS.indexOf(item.dataset.for);
    item.classList.toggle('current', position === current);
    item.classList.toggle('done', position < current);
  }
}

function startOnboarding(status, spotifyError, serviceReturn) {
  $('#onboarding').hidden = false;
  $('#page-title').textContent = 'Welcome';

  // step 1: the owner's name, previewed live in the logo
  const nameForm = $('#step-name');
  const nameInput = nameForm.elements.ownerName;
  const look = { pattern: pick(PATTERNS), colors: pickColors() };
  const preview = () => {
    const name = nameInput.value.trim() || 'Acciaw';
    renderBrand(name);
    $('#preview-title').textContent = `${name} Television`;
    $('#preview-logo').replaceChildren(createLogo({ ...look, letter: initialOf(name) }));
  };
  nameInput.value = status.ownerName ?? '';
  nameInput.addEventListener('input', preview);
  preview();
  nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(nameForm, async () => {
      await api('/api/channel', { method: 'PUT', body: JSON.stringify({ ownerName: nameInput.value }) });
      showStep(2);
    });
  });

  // step 2: a music service, spotify's form is the app, then the spotify login
  const spotifyForm = $('#step-spotify');
  spotifyForm.elements.clientId.value = status.spotify.clientId;
  describeSecret(spotifyForm.elements.clientSecret, status.spotify.secretSaved);
  $('[data-back]', spotifyForm).addEventListener('click', () => showStep(1));
  spotifyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(spotifyForm, async () => {
      await api('/api/spotify', { method: 'PUT', body: JSON.stringify(readSpotify(spotifyForm)) });
      location.href = '/auth/login';
    });
  });
  if (spotifyError) showError(spotifyForm, spotifyError);

  // other services' forms come from their templates
  const lineupForm = $('#step-lineup');
  const serviceCard = $('#step-service');
  const goToLineup = (fresh) => {
    renderServiceLineups(lineupForm, fresh, fresh.lineup);
    if (fresh.spotify.connected) loadPlaylists(lineupForm, fresh.lineup.playlists);
    showStep(3);
  };
  const pickService = (id) => {
    for (const button of $$('[data-pick]')) button.setAttribute('aria-selected', String(button.dataset.pick === id));
    spotifyForm.hidden = id !== 'spotify';
    serviceCard.hidden = id === 'spotify';
    if (id === 'spotify') return;
    $('.service-heading', serviceCard).textContent = `Connect ${SERVICES[id].name}`;
    const form = serviceForm(id);
    fillServiceForm(form, id, status);
    bindServiceForm(form, id, async (fresh) => {
      if (fresh.services[id].connected) goToLineup(fresh);
    });
    const back = element('button', 'ghost', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => showStep(1));
    $('.actions', form).prepend(back);
    $('.service-slot', serviceCard).replaceChildren(form);
    if (serviceReturn.service === id && serviceReturn.message) showError(form, serviceReturn.message);
  };
  for (const button of $$('[data-pick]')) button.addEventListener('click', () => pickService(button.dataset.pick));

  // step 3: the lineup, then a first build
  fillLineup(lineupForm, status.lineup);
  lineupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pickedSources(lineupForm)) {
      showError(lineupForm, 'Pick at least one source: liked songs, top tracks or a playlist.');
      return;
    }
    const lineup = { ...readLineup(lineupForm), services: readServiceLineups(lineupForm) };
    submitting(lineupForm, async () => {
      setStatus(lineupForm, `Building your lineup. This reads your ${status.spotify.connected ? 'Spotify ' : ''}library and can take a minute…`);
      try {
        const library = await api('/api/onboarding/finish', { method: 'POST', body: JSON.stringify(lineup) });
        $('#done-summary').textContent = library.demo
          ? `Those sources had no songs, so the TV plays a demo lineup until you pick others in the control room.`
          : `${library.count} songs are in your lineup. KTV looks up each music video the first time it comes up.`;
        showStep('done');
        setOnAir(true);
      } finally {
        setStatus(lineupForm, '');
      }
    });
  });

  if (!status.ownerName) {
    showStep(1);
    pickService('spotify');
  } else if (!anyServiceConnected(status)) {
    showStep(2);
    pickService(serviceReturn.service in SERVICES ? serviceReturn.service : 'spotify');
  } else {
    pickService('spotify');
    goToLineup(status);
  }
}

// control room

function renderSpotify(form, spotify) {
  form.elements.clientId.value = spotify.clientId;
  describeSecret(form.elements.clientSecret, spotify.secretSaved);
  $('.spotify-state', form).textContent = !spotify.configured
    ? 'No Spotify app yet. Add its client ID and secret to put the channel back on air.'
    : spotify.connected
      ? 'Connected. KTV reads your library only when the lineup is rebuilt, and never plays anything on your account.'
      : 'The app is saved but not connected to your Spotify account. Reconnect to finish.';
  $('#reconnect', form).hidden = !spotify.configured;
  $('#remove-spotify', form).hidden = !spotify.configured;
}

function renderKeys(form, keys) {
  for (const name of ['lastfm', 'youtube']) {
    describeSecret(form.elements[name], keys[name], 'Not set');
    $(`[data-remove="${name}"]`, form).hidden = !keys[name];
  }
  const lineupForm = $('#lineup-form');
  lineupForm.elements.discoveryShare.disabled = !keys.lastfm;
  $('.discovery-note', lineupForm).textContent = keys.lastfm
    ? 'Picked from Last.fm "similar tracks" of songs in your lineup.'
    : 'Add a Last.fm API key under Optional services to turn on discovery.';
}

function renderLibraryInfo(info) {
  if (!info) {
    $('#library-info').textContent = 'The lineup is built the first time a TV tunes in.';
    return;
  }
  const sources = Object.entries(info.sources ?? {}).map(([name, n]) => `${n} ${SOURCE_NAMES[name] ?? name}`).join(', ');
  $('#library-info').textContent =
    `${info.count} tracks on the lineup${info.demo ? ' (demo)' : ''}${sources ? ` — ${sources}` : ''} · built ${new Date(info.builtAt).toLocaleString()}`;
}

function startControlRoom(status, spotifyError, serviceReturn) {
  $('#control-room').hidden = false;
  $('#open-tv').hidden = false;

  const channelForm = $('#channel-form');
  channelForm.elements.ownerName.value = status.ownerName ?? '';
  channelForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(channelForm, async () => {
      const channel = await api('/api/channel', { method: 'PUT', body: JSON.stringify({ ownerName: channelForm.elements.ownerName.value }) });
      renderBrand(channel.name);
      setStatus(channelForm, 'Saved. Reload the TV to see it.');
    });
  });

  const spotifyForm = $('#spotify-form');
  renderSpotify(spotifyForm, status.spotify);
  spotifyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitting(spotifyForm, async () => {
      await api('/api/spotify', { method: 'PUT', body: JSON.stringify(readSpotify(spotifyForm)) });
      const { spotify } = await api('/api/status');
      renderSpotify(spotifyForm, spotify);
      setStatus(spotifyForm, spotify.connected ? 'Saved.' : 'Saved. Reconnect to finish.');
    });
  });
  $('#reconnect').addEventListener('click', () => { location.href = '/auth/login'; });
  $('#remove-spotify').addEventListener('click', () => {
    if (!confirm('Remove the Spotify app from KTV? The TV stays off the air until you add one again.')) return;
    submitting(spotifyForm, async () => {
      await api('/api/spotify', { method: 'DELETE' });
      renderSpotify(spotifyForm, (await api('/api/status')).spotify);
      setStatus(spotifyForm, 'Removed.');
    });
  });
  if (spotifyError) showError(spotifyForm, spotifyError);

  const keysForm = $('#keys-form');
  const lineupForm = $('#lineup-form');

  // more music services: a foldout each, open when coming back from that service's login
  const redraws = new Map();
  const servicesChanged = async (fresh) => {
    for (const redraw of redraws.values()) redraw(fresh);
    updateTally(fresh);
    renderKeys(keysForm, fresh.keys);
    renderServiceLineups(lineupForm, fresh, fresh.lineup);
  };
  $('#services-card .service-list').replaceChildren(...SERVICE_ORDER.map((id) => {
    const details = element('details', 'service');
    const badge = element('span', 'badge');
    const summary = element('summary');
    summary.append(element('span', '', SERVICES[id].name), badge);
    const form = serviceForm(id);
    details.append(summary, form);
    redraws.set(id, (fresh) => {
      const service = fresh.services[id];
      badge.textContent = service.connected ? 'Connected' : service.configured ? 'Not connected' : 'Not set up';
      badge.classList.toggle('on', service.connected);
      badge.dataset.state = service.connected ? 'on' : service.configured ? 'standby' : 'off';
      fillServiceForm(form, id, fresh);
    });
    redraws.get(id)(status);
    bindServiceForm(form, id, servicesChanged);
    if (serviceReturn.service === id) {
      details.open = true;
      if (serviceReturn.message) showError(form, serviceReturn.message);
      else if (status.services[id].connected) setStatus(form, 'Connected.');
    }
    return details;
  }));

  keysForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const keys = {};
    for (const name of ['lastfm', 'youtube']) {
      const value = keysForm.elements[name].value.trim();
      if (value) keys[name] = value;
    }
    if (!Object.keys(keys).length) {
      setStatus(keysForm, 'Type a key to save it.');
      return;
    }
    submitting(keysForm, async () => {
      renderKeys(keysForm, await api('/api/keys', { method: 'PUT', body: JSON.stringify(keys) }));
      setStatus(keysForm, 'Saved.');
    });
  });
  for (const button of $$('[data-remove]', keysForm)) {
    button.addEventListener('click', () => submitting(keysForm, async () => {
      renderKeys(keysForm, await api('/api/keys', { method: 'PUT', body: JSON.stringify({ [button.dataset.remove]: null }) }));
      setStatus(keysForm, 'Removed.');
    }));
  }

  fillLineup(lineupForm, status.lineup);
  const share = lineupForm.elements.discoveryShare;
  const updateShare = () => { $('.share-out', lineupForm).textContent = `${Math.round(Number(share.value) * 100)}%`; };
  share.value = status.lineup.discoveryShare;
  share.addEventListener('input', updateShare);
  updateShare();
  renderKeys(keysForm, status.keys);
  if (status.spotify.connected) loadPlaylists(lineupForm, status.lineup.playlists);
  else $('.playlists', lineupForm).textContent = 'Connect Spotify to pick playlists.';
  renderServiceLineups(lineupForm, status, status.lineup);

  bindEras(lineupForm);
  bindArtists(lineupForm);
  const loadFilters = async (lineup) => {
    const overview = await api('/api/lineup/overview').catch(() => null);
    setupEras(lineupForm, overview, lineup.eras);
    setupArtists(lineupForm, overview, lineup.excludedArtists);
  };
  loadFilters(status.lineup);

  lineupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const artists = readArtists(lineupForm);
    if (artists?.noneChecked) {
      showError(lineupForm, 'Keep at least one artist checked.');
      return;
    }
    submitting(lineupForm, async () => {
      const lineup = { ...readLineup(lineupForm), services: readServiceLineups(lineupForm) };
      const eras = readEras(lineupForm);
      if (eras) lineup.eras = eras;
      if (artists) lineup.excludedArtists = artists.excluded;
      await api('/api/lineup', { method: 'PUT', body: JSON.stringify(lineup) });
      setStatus(lineupForm, 'Saved. Eras and artists apply from the next song; new sources join when the lineup rebuilds.');
    });
  });
  $('#refresh').addEventListener('click', () => submitting(lineupForm, async () => {
    setStatus(lineupForm, 'Reading your library…');
    renderLibraryInfo(await api('/api/library/refresh', { method: 'POST' }));
    const fresh = await api('/api/status');
    updateTally(fresh);
    await loadFilters(fresh.lineup);
    setStatus(lineupForm, 'Lineup rebuilt.');
  }));
  renderLibraryInfo(status.library);
  updateTally(status);
  startStudioClock();
  // spotify's form keeps its own logic, a change to its state line is the cue to refresh the tally lights
  new MutationObserver(() => api('/api/status').then(updateTally).catch(() => {})).observe($('.spotify-state', spotifyForm), { childList: true });
}

// boot

async function main() {
  const params = new URLSearchParams(location.search);
  const spotifyError = params.get('spotify_error');
  // coming back from another service's login, which one and what went wrong if anything did
  const serviceReturn = { service: params.get('service'), message: params.get('service_error') };
  if (spotifyError || serviceReturn.service) history.replaceState(null, '', location.pathname);
  const status = await api('/api/status');
  $('#loading').hidden = true;
  renderBrand(status.channel.name);
  startLogoLoop();
  renderRedirectUri(status.spotify.redirectUri);
  if (!status.onboarded) return startOnboarding(status, spotifyError, serviceReturn);
  const page = location.pathname.replace(/\/+$/, '') === '/admin/stats' ? 'stats' : 'control-room';
  showAdminNav(page);
  if (page === 'control-room') return startControlRoom(status, spotifyError, serviceReturn);
  // stats page keeps the masthead and its on-air sign, the numbers come from stats.js
  document.title = 'KTV Stats';
  $('#page-title').textContent = 'Stats';
  $('#open-tv').hidden = false;
  setOnAir(anyServiceConnected(status));
  const { startStats } = await import('./stats.js');
  await startStats($('#stats'));
}

main().catch((err) => {
  $('#loading').textContent = `Something went wrong: ${err.message}`;
});
