// discovery picks, spotify's recommendations api is closed to new apps so similarity comes from last.fm
import { getSettings } from './settings.js';

export const lastfmEnabled = () => Boolean(getSettings().keys.lastfm);

async function call(params, apiKey = getSettings().keys.lastfm) {
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({ ...params, api_key: apiKey, format: 'json' })}`);
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
  if (!res.ok) throw new Error(`Last.fm answered ${res.status}`);
  return data;
}

// checks a key with a cheap lookup before it's saved
export async function checkLastfmKey(apiKey) {
  await call({ method: 'artist.getinfo', artist: 'Cher' }, apiKey);
}

// your last.fm profile as a music service, loved tracks and top tracks from any app

export async function checkLastfmUser(username) {
  const data = await call({ method: 'user.getinfo', user: username });
  return { name: data.user?.name ?? username };
}

function lastfmTrack(t, source) {
  const artist = t.artist?.name ?? t.artist?.['#text'];
  if (!t.name || !artist) return null;
  return {
    key: `lastfm:${artist}|${t.name}`.toLowerCase(),
    title: t.name,
    artists: [artist],
    album: null,
    albumType: null,
    year: null,
    durationMs: Number(t.duration) ? Number(t.duration) * 1000 : null,
    image: null,
    source,
  };
}

// last.fm sends a single item as an object instead of a list
const list = (value) => [].concat(value ?? []);

export async function lastfmUserTracks({ loved, top }) {
  const { username } = getSettings().services.lastfm;
  const tracks = [];
  if (loved) {
    for (let page = 1, pages = 1; page <= pages && page <= 20; page++) {
      const data = await call({ method: 'user.getlovedtracks', user: username, limit: '500', page: String(page) });
      pages = Number(data.lovedtracks?.['@attr']?.totalPages ?? 1);
      tracks.push(...list(data.lovedtracks?.track).map((t) => lastfmTrack(t, 'lastfm-loved')));
    }
  }
  if (top) {
    const data = await call({ method: 'user.gettoptracks', user: username, period: '6month', limit: '200' });
    tracks.push(...list(data.toptracks?.track).map((t) => lastfmTrack(t, 'lastfm-top')));
  }
  return tracks.filter(Boolean);
}

export async function similarTracks(artist, title, limit = 25) {
  if (!lastfmEnabled()) return [];
  const data = await call({ method: 'track.getsimilar', artist, track: title, autocorrect: '1', limit: String(limit) });
  return (data.similartracks?.track ?? []).map((t) => ({
    key: `lastfm:${t.artist.name}|${t.name}`.toLowerCase(),
    title: t.name,
    artists: [t.artist.name],
    album: null,
    year: null,
    durationMs: null,
    image: null,
    source: 'discovery',
  }));
}
