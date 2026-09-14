// your apple music library as a service, read with apple's musickit through a key from your developer account
import crypto from 'node:crypto';
import { getSettings } from './settings.js';
import { readJson, removeJson, writeJson } from './store.js';

const TOKEN_FILE = 'applemusic-token.json';
const API = 'https://api.music.apple.com';
const MAX_ITEMS = 10000;

export function appleMusicConfigured() {
  const { teamId, keyId, privateKey } = getSettings().services.applemusic;
  return Boolean(teamId && keyId && privateKey);
}

// the .p8 file's contents as a pem key, whether or not its header lines were pasted along
export function tidyPrivateKey(text) {
  const body = String(text ?? '').replace(/-----(?:BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return body ? `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` : '';
}

// a musickit developer token, a jwt signed with the key (es256)
export function developerToken({ teamId, keyId, privateKey } = getSettings().services.applemusic, seconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'ES256', kid: keyId })}.${part({ iss: teamId, iat: now, exp: now + seconds })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

async function request(path, { developer = developerToken(), user } = {}) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${developer}`, ...(user && { 'Music-User-Token': user }) } });
  if (!res.ok) throw new Error(`Apple Music answered ${res.status}${res.status === 401 || res.status === 403 ? ', refusing the key or the sign-in' : ''}`);
  return res.json();
}

// searching the catalog needs a valid developer token, apple refuses a wrong one
export async function checkAppleMusicKey(credentials) {
  let token;
  try {
    token = developerToken(credentials, 300);
  } catch {
    throw new Error("the private key couldn't be read; paste the whole .p8 file");
  }
  await request('/v1/catalog/us/search?term=music&types=songs&limit=1', { developer: token });
}

export async function connectAppleMusic(musicUserToken) {
  await request('/v1/me/storefront', { user: musicUserToken });
  await writeJson(TOKEN_FILE, { musicUserToken, savedAt: Date.now() });
}

export const appleMusicConnected = async () => Boolean((await readJson(TOKEN_FILE, null))?.musicUserToken);
export const disconnectAppleMusic = () => removeJson(TOKEN_FILE);

async function paginate(path) {
  const saved = await readJson(TOKEN_FILE, null);
  if (!saved?.musicUserToken) throw new Error('Apple Music is not connected.');
  const developer = developerToken();
  const items = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}limit=100`;
  while (next && items.length < MAX_ITEMS) {
    const page = await request(next, { developer, user: saved.musicUserToken });
    items.push(...(page.data ?? []));
    next = page.next ? `${page.next}${page.next.includes('limit=') ? '' : '&limit=100'}` : null;
  }
  return items;
}

const artwork = (art) => art?.url?.replace('{w}', '300').replace('{h}', '300') ?? null;

export async function appleMusicPlaylists() {
  return (await paginate('/v1/me/library/playlists')).map((p) => ({
    id: p.id,
    name: p.attributes?.name || 'Untitled',
    owner: '',
    total: null,
    image: artwork(p.attributes?.artwork),
    readable: true,
  }));
}

function toTrack(song, source) {
  const a = song.attributes ?? {};
  if (!a.name || !a.artistName) return null;
  return {
    key: `applemusic:${song.id}`,
    title: a.name,
    artists: [a.artistName],
    album: a.albumName ?? null,
    albumType: null,
    year: a.releaseDate?.slice(0, 4) ?? null,
    durationMs: a.durationInMillis ?? null,
    image: artwork(a.artwork),
    source,
  };
}

export async function appleMusicTracks({ library, playlists = [] }) {
  const tracks = [];
  if (library) tracks.push(...(await paginate('/v1/me/library/songs')).map((song) => toTrack(song, 'applemusic-library')));
  for (const id of playlists) {
    const items = await paginate(`/v1/me/library/playlists/${encodeURIComponent(id)}/tracks`).catch((err) => {
      console.warn(`Skipping Apple Music playlist ${id}: ${err.message}`);
      return [];
    });
    tracks.push(...items.map((song) => toTrack(song, 'applemusic-playlist')));
  }
  return tracks.filter(Boolean);
}
