// the lineup, a snapshot of your songs from spotify and other connected services, refreshed lazily when the tv asks for a clip
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { demoTracks } from './demo.js';
import { lastfmEnabled, similarTracks } from './lastfm.js';
import { knownRelease, originalRelease } from './releases.js';
import { SERVICES, connectedServices } from './services.js';
import { getSettings, updateSettings } from './settings.js';
import * as spotify from './spotify.js';
import { readJson, writeJson } from './store.js';
import { baseTitle, normalize } from './text.js';
import { resolveVideo } from './youtube.js';

const LIBRARY_FILE = 'library.json';
// with live performances on, the chance a song plays live instead of its music video
const LIVE_SHARE = 0.5;
// a tv page load is a session, one nobody has asked anything of for this long is forgotten
const SESSION_IDLE_MS = 12 * 3600_000;
// how long a clip waits for its original album and year before airing with the service's, the lookup still finishes and is remembered, long enough to ride out musicbrainz's busy answers
const RELEASE_WAIT_MS = 10_000;

let library = null;
let building = null;
const sessions = new Map();
const similarCache = new Map();
const libraryIndex = new WeakMap();

const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const songId = (artist, title) => `${artist}|${title}`.toLowerCase();
// the same song saved on two services, whatever tags each puts on it
const sameSong = (track) => `${normalize(track.artists[0])}|${normalize(baseTitle(track.title))}`;

export async function saveLineup(input = {}) {
  const current = getSettings().lineup;
  const share = Number(input.discoveryShare);
  const lineup = {
    playlists: Array.isArray(input.playlists) ? input.playlists.map(String) : current.playlists,
    includeLiked: typeof input.includeLiked === 'boolean' ? input.includeLiked : current.includeLiked,
    includeTop: typeof input.includeTop === 'boolean' ? input.includeTop : current.includeTop,
    includeLive: typeof input.includeLive === 'boolean' ? input.includeLive : current.includeLive,
    discoveryShare: Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : current.discoveryShare,
    services: Object.fromEntries(Object.entries(current.services).map(([id, saved]) => [id, serviceLineup(saved, input.services?.[id])])),
    eras: eraRange(input.eras, current.eras),
    excludedArtists: Array.isArray(input.excludedArtists)
      ? [...new Set(input.excludedArtists.map((name) => String(name).trim()).filter(Boolean))]
      : current.excludedArtists,
  };
  await updateSettings((settings) => { settings.lineup = lineup; });
  return lineup;
}

// a service's switches and playlist lists as sent, keeping only the ones the service has
function serviceLineup(saved, input) {
  if (!input || typeof input !== 'object') return saved;
  return Object.fromEntries(Object.entries(saved).map(([name, value]) => {
    if (Array.isArray(value)) return [name, Array.isArray(input[name]) ? input[name].map(String) : value];
    return [name, typeof input[name] === 'boolean' ? input[name] : value];
  }));
}

// decade bounds as sent (1970 not 1975), or the saved ones when none were sent
function eraRange(input, saved) {
  if (input === undefined) return saved;
  const decade = (value) => (Number.isInteger(value) && value >= 1900 && value <= 2100 ? Math.floor(value / 10) * 10 : null);
  const from = decade(input?.from);
  const to = decade(input?.to);
  return from !== null && to !== null && from > to ? { from: to, to: from } : { from, to };
}

// only the settings that change which tracks are in the snapshot
const sourcesKey = (lineup, services) =>
  JSON.stringify([lineup.playlists, lineup.includeLiked, lineup.includeTop, services.map((id) => [id, lineup.services[id]])]);

async function loadLibrary({ force = false } = {}) {
  const { lineup } = getSettings();
  const connected = await spotify.isConnected();
  const services = await connectedServices();
  library ??= await readJson(LIBRARY_FILE, null);
  const fresh =
    library &&
    library.connected === connected &&
    library.sourcesKey === sourcesKey(lineup, services) &&
    Date.now() - library.builtAt < config.libraryTtlHours * 3600_000;
  if (fresh && !force) return library;

  building ??= build(lineup, connected, services)
    .catch((err) => {
      if (!library?.tracks?.length || force) throw err;
      console.warn(`Library refresh failed, keeping the previous snapshot: ${err.message}`);
      return library;
    })
    .finally(() => { building = null; });
  return building;
}

async function build(lineup, connected, services) {
  if (!connected && !services.length) {
    library = { builtAt: Date.now(), connected, sourcesKey: sourcesKey(lineup, services), demo: true, tracks: demoTracks, sources: { demo: demoTracks.length } };
    return library;
  }

  // sequential on purpose, this runs rarely and there's no hurry
  const batches = [];
  if (connected) {
    for (const id of lineup.playlists) {
      batches.push(await spotify.playlistTracks(id).catch((err) => {
        console.warn(`Skipping playlist ${id}: ${err.message}`);
        return [];
      }));
    }
    if (lineup.includeLiked) batches.push(await spotify.likedTracks());
    if (lineup.includeTop) batches.push(await spotify.topTracks());
  }
  const others = [];
  for (const id of services) {
    others.push(...(await SERVICES[id].tracks(lineup.services[id]).catch((err) => {
      console.warn(`Skipping ${SERVICES[id].name}: ${err.message}`);
      return [];
    })));
  }

  const byKey = new Map();
  const songs = new Set();
  const sources = {};
  const add = (track) => {
    byKey.set(track.key, track);
    songs.add(sameSong(track));
    sources[track.source] = (sources[track.source] ?? 0) + 1;
  };
  for (const track of batches.flat()) {
    if (!byKey.has(track.key)) add(track);
  }
  // other services come after spotify, a song already in isn't added a second time
  for (const track of others) {
    if (!byKey.has(track.key) && !songs.has(sameSong(track))) add(track);
  }
  const tracks = [...byKey.values()];
  library = {
    builtAt: Date.now(),
    connected,
    sourcesKey: sourcesKey(lineup, services),
    demo: tracks.length === 0,
    tracks: tracks.length ? tracks : demoTracks,
    sources,
  };
  await writeJson(LIBRARY_FILE, library);
  console.log(`Library rebuilt: ${tracks.length} tracks`, sources);
  return library;
}

export const refreshLibrary = () => loadLibrary({ force: true }).then(libraryInfo);

export function libraryInfo() {
  if (!library) return null;
  return { count: library.tracks.length, builtAt: library.builtAt, demo: library.demo, sources: library.sources };
}

// within a session a song never plays twice until the whole lineup has aired, reloading the tv starts a new session
function sessionFor(id) {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.seenAt > SESSION_IDLE_MS) sessions.delete(key);
  }
  let session = sessions.get(id);
  if (!session) {
    session = { played: new Set(), retryQueue: [], served: 0 };
    sessions.set(id, session);
  }
  session.seenAt = now;
  return session;
}

function pickFromLibrary(tracks, session) {
  let options = tracks.filter((t) => !session.played.has(t.key));
  if (!options.length) {
    // everything has aired this session, the lineup starts over
    for (const track of tracks) session.played.delete(track.key);
    options = tracks;
  }
  return randomItem(options);
}

// a song similar to one from seeds that isn't in the lineup at all
async function pickDiscovery(lib, seeds, session, excluded) {
  const seed = randomItem(seeds);
  if (!similarCache.has(seed.key)) {
    similarCache.set(seed.key, await similarTracks(seed.artists[0], seed.title).catch(() => []));
  }
  let known = libraryIndex.get(lib);
  if (!known) {
    known = new Set(lib.tracks.map((t) => songId(t.artists[0], t.title)));
    libraryIndex.set(lib, known);
  }
  const options = similarCache.get(seed.key).filter((t) =>
    !known.has(songId(t.artists[0], t.title)) && !session.played.has(t.key) && !isExcluded(t, excluded));
  if (!options.length) return null;
  return { ...randomItem(options), seed: { title: seed.title, artist: seed.artists[0] } };
}

// filters: eras and artists

// a song's first release year as far as it's known without asking anyone, musicbrainz if looked up already, otherwise the service's album year unless it's a compilation
async function knownYear(track) {
  const original = await knownRelease(track);
  if (original?.found && original.year) return Number(original.year);
  return track.albumType === 'compilation' ? null : Number(track.year) || null;
}

const inEras = (year, { from, to }) => (from === null || year >= from) && (to === null || year < to + 10);
const eraLimited = ({ from, to }) => from !== null || to !== null;
const isExcluded = (track, excluded) => track.artists.some((name) => excluded.has(name.toLowerCase()));

// songs the filters let through, a song with no known year yet stays in and gets looked up when it comes up
async function filterTracks(tracks, lineup, excluded) {
  const kept = [];
  for (const track of tracks) {
    if (isExcluded(track, excluded)) continue;
    if (eraLimited(lineup.eras)) {
      const year = await knownYear(track);
      if (year && !inEras(year, lineup.eras)) continue;
    }
    kept.push(track);
  }
  return kept;
}

// what /admin's era slider and artist list are built from, how many songs come from each known decade and every artist
export async function lineupOverview() {
  const lib = library ?? (await readJson(LIBRARY_FILE, null));
  if (!lib) return null;
  const decades = new Map();
  const artists = new Map();
  let unknownYear = 0;
  for (const track of lib.tracks) {
    const year = await knownYear(track);
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      decades.set(decade, (decades.get(decade) ?? 0) + 1);
    } else {
      unknownYear++;
    }
    for (const name of new Set(track.artists)) {
      const entry = artists.get(name.toLowerCase()) ?? { name, songs: 0 };
      entry.songs++;
      artists.set(name.toLowerCase(), entry);
    }
  }
  return {
    builtAt: lib.builtAt,
    demo: lib.demo,
    songs: lib.tracks.length,
    unknownYear,
    decades: [...decades].sort(([a], [b]) => a - b).map(([decade, songs]) => ({ decade, songs })),
    artists: [...artists.values()].sort((a, b) => b.songs - a.songs || a.name.localeCompare(b.name)),
  };
}

// album and year the title card shows, where the song first came out, not the compilation or remaster it was saved from
async function withOriginalRelease(track) {
  const lookup = originalRelease(track).catch((err) => {
    console.warn(`Release lookup failed for ${track.artists[0]} - ${track.title}: ${err.message}`);
    return null;
  });
  const original = await Promise.race([lookup, sleep(RELEASE_WAIT_MS, null)]);
  const { albumType } = track;
  // snapshots built before album types were kept don't say, so the service's album is only trusted when nothing better came
  const spotifyAlbum = albumType === 'album' || (!albumType && !original?.found) ? track.album : null;
  if (original?.found) return { ...track, album: original.album ?? spotifyAlbum, year: original.year };
  return { ...track, album: spotifyAlbum, year: albumType === 'compilation' ? null : track.year };
}

export async function nextItem(sessionId) {
  const lib = await loadLibrary();
  const session = sessionFor(sessionId);
  const { lineup } = getSettings();
  const { discoveryShare, includeLive, eras } = lineup;
  const excluded = new Set(lineup.excludedArtists.map((name) => name.toLowerCase()));
  const filtered = await filterTracks(lib.tracks, lineup, excluded);
  if (!filtered.length) console.warn('The era and artist filters leave no songs in the lineup, so all of it plays.');
  // filters that leave nothing would take the channel off the air
  const pool = filtered.length ? filtered : lib.tracks;
  const checkEras = filtered.length > 0 && eraLimited(eras);
  for (let attempt = 0; attempt < (checkEras ? 16 : 8); attempt++) {
    // a song whose lookup failed for a passing reason gets one more try after the next song
    const retryIndex = session.retryQueue.findIndex((entry) => session.served > entry.after);
    const retry = retryIndex >= 0 ? session.retryQueue.splice(retryIndex, 1)[0] : null;
    const wantsDiscovery = !retry && !lib.demo && lastfmEnabled() && Math.random() < discoveryShare;
    const track = retry?.track ?? ((wantsDiscovery && (await pickDiscovery(lib, pool, session, excluded))) || pickFromLibrary(pool, session));
    session.played.add(track.key);
    // a song whose year wasn't known when the filters ran gets it looked up now, skipped if it's from another era
    if (checkEras && !retry && !(await knownYear(track))) {
      const original = await Promise.race([originalRelease(track).catch(() => null), sleep(RELEASE_WAIT_MS, null)]);
      if (!original?.found || !original.year || !inEras(Number(original.year), eras)) continue;
    }
    let video = null;
    try {
      video = await resolveVideo(track, { live: includeLive && Math.random() < LIVE_SHARE });
    } catch (err) {
      console.warn(`YouTube lookup failed for ${track.artists[0]} - ${track.title}: ${err.message}`);
      if (!retry) session.retryQueue.push({ track, after: session.served });
    }
    if (video) {
      session.served++;
      return { ...(await withOriginalRelease(track)), video };
    }
  }
  throw new Error('Could not find a playable video for any picked track.');
}
