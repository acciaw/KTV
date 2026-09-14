// the album a song first came out on and the year, from musicbrainz, looked up once per song and cached in data/release-cache.json
import { setTimeout as sleep } from 'node:timers/promises';
import { readJson, writeJson } from './store.js';
import { baseTitle, nameKey, normalize } from './text.js';

const CACHE_FILE = 'release-cache.json';
// bump when the rules change, so every song is looked up again
const CACHE_VERSION = 5;
// songs musicbrainz doesn't know are asked about again after this long
const RETRY_UNKNOWN_MS = 30 * 24 * 3600_000;
// musicbrainz takes one request per second per client, answers 503 when busy, wants clients to name themselves
const MIN_GAP_MS = 1100;
const BUSY_RETRY_MS = [2000, 5000];
const TIMEOUT_MS = 8000;
const USER_AGENT = 'KTV/1.0 ( self-hosted music television )';
// releases that aren't the song as first put out: concerts, remixes, dj mixes, demos, interviews
const NOT_ORIGINAL = new Set(['Live', 'Remix', 'DJ-mix', 'Mixtape/Street', 'Demo', 'Interview', 'Spokenword', 'Audiobook', 'Audio drama']);
// an album is trusted without a second look only when it's the earliest date known to the month with enough editions, others get checked as a possible later reissue, up to this many albums per song
const FEW_EDITIONS = 2;
const MAX_ALBUMS = 25;

let cache = null;
let saveTimer = null;
let queue = Promise.resolve();
let lastRequestAt = 0;
const lookups = new Map();

async function getCache() {
  if (!cache) {
    const stored = await readJson(CACHE_FILE, null);
    cache = stored?.version === CACHE_VERSION ? stored.entries : {};
  }
  return cache;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeJson(CACHE_FILE, { version: CACHE_VERSION, entries: cache }).catch((err) => console.error('Saving release cache failed:', err));
  }, 1000);
}

// one request at a time, spaced out, with a couple of retries while musicbrainz is busy
function musicbrainz(path) {
  const request = queue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now()));
      lastRequestAt = Date.now();
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 503 && attempt < BUSY_RETRY_MS.length) {
        await sleep(BUSY_RETRY_MS[attempt]);
        continue;
      }
      if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`);
      return res.json();
    }
  });
  queue = request.catch(() => {});
  return request;
}

// a title as written, brackets and all, and its bare name, with spotify's remaster and feat tags dropped from both
function titleKeys(title) {
  const untagged = title.replace(/\s+[-–]\s+.*$/, '').replace(/\s*[([](?:feat|ft|with)\b[^)\]]*[)\]]/gi, '');
  return [normalize(untagged), normalize(baseTitle(title))];
}

function isSameSong(recording, track) {
  const [written, bare] = titleKeys(track.title);
  const [recordingWritten, recordingBare] = titleKeys(recording.title);
  if (written !== recordingWritten && bare !== recordingBare) return false;
  const artists = track.artists.map(nameKey);
  return (recording['artist-credit'] ?? []).some((credit) => [credit.name, credit.artist?.name].some((name) => name && artists.includes(nameKey(name))));
}

// whether a recording is written like the track, counting the disambiguation musicbrainz tells same named recordings apart by
function writtenAlike(recording, track) {
  const [written] = titleKeys(track.title);
  if (titleKeys(recording.title)[0] === written) return true;
  return Boolean(recording.disambiguation) && normalize(`${recording.title} ${recording.disambiguation}`) === written;
}

// whether a release is the artist's own record, not someone else's the song is on like a soundtrack credited to various artists or its composer
function ownRelease(release, recording, track) {
  const credits = release['artist-credit'];
  if (!credits?.length) return true;
  const names = [...track.artists, ...(recording['artist-credit'] ?? []).flatMap((credit) => [credit.name, credit.artist?.name])]
    .filter(Boolean)
    .map(nameKey);
  return credits.some((credit) => [credit.name, credit.artist?.name].some((name) => name && names.includes(nameKey(name))));
}

// earlier of two musicbrainz dates, and between two that agree as far as both go, the more precise one wins
function earliest(a, b) {
  if (!a) return b;
  const common = Math.min(a.length, b.length);
  if (a.slice(0, common) !== b.slice(0, common)) return a.slice(0, common) < b.slice(0, common) ? a : b;
  return a.length >= b.length ? a : b;
}

// earliest release date and the albums or eps that carry it, ranked by month, compilations and other artists' albums don't count except soundtracks from within a year, which lose to the artist's own album from around the same time
function releasesOf(recordings, track) {
  let firstDate = null;
  const albums = new Map();
  for (const recording of recordings) {
    if (!isSameSong(recording, track) || /\b(live|demo|remix|instrumental|karaoke)\b/i.test(recording.disambiguation ?? '')) continue;
    const written = writtenAlike(recording, track);
    for (const release of recording.releases ?? []) {
      const group = release['release-group'] ?? {};
      const types = group['secondary-types'] ?? [];
      if ((release.status && release.status !== 'Official') || !release.date || types.some((type) => NOT_ORIGINAL.has(type))) continue;
      firstDate = earliest(firstDate, release.date);
      const soundtrack = types.includes('Soundtrack');
      if (!['Album', 'EP'].includes(group['primary-type']) || types.some((type) => type !== 'Soundtrack' && !(soundtrack && type === 'Compilation'))) continue;
      const album = albums.get(group.id)
        ?? { id: group.id, title: group.title, type: group['primary-type'], date: null, editions: 0, soundtrack, compilation: types.includes('Compilation'), own: false, written: false };
      album.editions++;
      album.written ||= written;
      album.own ||= ownRelease(release, recording, track);
      album.date = earliest(album.date, release.date);
      albums.set(group.id, album);
    }
  }
  const month = (album) => (album.soundtrack && (album.compilation || !album.own)
    ? `${Number(album.date.slice(0, 4)) + 1}${album.date.slice(4, 7)}`
    : album.date.slice(0, 7));
  const ranked = [...albums.values()]
    .filter((album) => (album.soundtrack ? monthsBetween(firstDate, album.date) <= 12 : album.own))
    .sort((a, b) => month(a).localeCompare(month(b)) || b.written - a.written || a.date.localeCompare(b.date) || b.editions - a.editions);
  return { firstDate, albums: [...ranked.filter((album) => album.type === 'Album'), ...ranked.filter((album) => album.type === 'EP')] };
}

// months from one musicbrainz date to another, as precisely as both allow
function monthsBetween(earlier, later) {
  const [fromYear, fromMonth] = earlier.split('-').map(Number);
  const [toYear, toMonth] = later.split('-').map(Number);
  return (toYear - fromYear) * 12 + (fromMonth && toMonth ? toMonth - fromMonth : 0);
}

// when each album first came out, from one search for all of them
async function firstReleases(albums) {
  const query = albums.map((album) => `rgid:${album.id}`).join(' OR ');
  const data = await musicbrainz(`release-group?${new URLSearchParams({ query, limit: String(albums.length), fmt: 'json' })}`);
  return new Map((data['release-groups'] ?? []).map((group) => [group.id, group['first-release-date']]));
}

async function lookup(track) {
  const phrase = (text) => `"${text.replace(/["\\]/g, ' ')}"`;
  // concert recordings and bootlegs can outnumber the studio versions and push them off the first page, dropping a leading "the" matches bands however they're listed ("The Beatles", "Goo Goo Dolls")
  const artist = track.artists[0].replace(/^the\s+/i, '');
  const query = `recording:${phrase(baseTitle(track.title))} AND artist:${phrase(artist)} AND status:official AND video:false AND NOT comment:live`;
  const data = await musicbrainz(`recording?${new URLSearchParams({ query, limit: '100', fmt: 'json' })}`);
  const { firstDate, albums } = releasesOf(data.recordings ?? [], track);
  const candidates = albums.slice(0, MAX_ALBUMS);
  let firsts = null;
  let album = null;
  for (const candidate of candidates) {
    if (candidate.editions > FEW_EDITIONS && candidate.date.length > 4 && candidate.date === firstDate) {
      album = candidate;
      break;
    }
    // an album only carrying the song on editions from after it first came out is a reissue with bonus tracks, not where the song came from
    firsts ??= await firstReleases(candidates);
    const first = firsts.get(candidate.id);
    if (!first || monthsBetween(first, candidate.date) <= 1) {
      album = candidate;
      break;
    }
  }
  return { found: Boolean(firstDate), album: album?.title ?? null, year: firstDate?.slice(0, 4) ?? null };
}

const songKey = (track) => `${nameKey(track.artists[0])}|${normalize(baseTitle(track.title))}`;

// what's already known about the track's first release without asking musicbrainz, null if never looked up
export async function knownRelease(track) {
  return (await getCache())[songKey(track)] ?? null;
}

// found, album, year for the track, rejects if musicbrainz can't be reached so callers fall back without remembering the failure
export async function originalRelease(track) {
  const key = songKey(track);
  const entries = await getCache();
  const known = entries[key];
  if (known && (known.found || Date.now() - known.checkedAt < RETRY_UNKNOWN_MS)) return known;
  if (!lookups.has(key)) {
    lookups.set(key, lookup(track)
      .then((result) => {
        entries[key] = { ...result, checkedAt: Date.now() };
        scheduleSave();
        return entries[key];
      })
      .finally(() => lookups.delete(key)));
  }
  return lookups.get(key);
}
