// spotify is only used to read what to play, nothing ever plays on the account itself
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { getSettings } from './settings.js';
import { readJson, removeJson, writeJson } from './store.js';

const TOKEN_FILE = 'spotify-tokens.json';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read', 'user-top-read'];

export class NotConnectedError extends Error {
  constructor() {
    super('Spotify is not connected. Open /admin to connect.');
  }
}

export const redirectUri = () => `${config.baseUrl}/auth/callback`;

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getSettings().spotify.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body, { clientId, clientSecret } = getSettings().spotify) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Spotify token request failed (${res.status})`);
  return data;
}

// an app only token is granted only when the client id and secret belong together
export async function checkAppCredentials(credentials) {
  await tokenRequest({ grant_type: 'client_credentials' }, credentials);
}

async function saveTokens(response, previous = {}) {
  const tokens = {
    access_token: response.access_token,
    // refresh responses may omit refresh_token, keep the old one then
    refresh_token: response.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (response.expires_in - 60) * 1000,
  };
  await writeJson(TOKEN_FILE, tokens);
  return tokens;
}

export async function exchangeCode(code) {
  await saveTokens(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }));
}

export async function isConnected() {
  return Boolean((await readJson(TOKEN_FILE, null))?.refresh_token);
}

export const disconnect = () => removeJson(TOKEN_FILE);

let refreshing = null;

async function accessToken() {
  const tokens = await readJson(TOKEN_FILE, null);
  if (!tokens?.refresh_token) throw new NotConnectedError();
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    .then((response) => saveTokens(response, tokens))
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

async function api(pathOrUrl) {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 429 && attempt < 3) {
      await sleep(Number(res.headers.get('retry-after') || 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Spotify ${res.status} on ${url}: ${await res.text()}`);
    return res.json();
  }
}

async function paginate(path) {
  const items = [];
  for (let url = path; url; ) {
    const page = await api(url);
    items.push(...page.items);
    url = page.next;
  }
  return items;
}

// playlist entries carry the track under item now, track is deprecated
const entryTrack = (entry) => entry?.item ?? entry?.track;

function toTrack(t, source) {
  if (!t || t.type !== 'track' || t.is_local || !t.id) return null;
  return {
    key: `spotify:${t.id}`,
    title: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album?.name ?? null,
    // 'album', 'single' or 'compilation'
    albumType: t.album?.album_type ?? null,
    year: t.album?.release_date?.slice(0, 4) ?? null,
    durationMs: t.duration_ms ?? null,
    image: t.album?.images?.[0]?.url ?? null,
    source,
  };
}

export async function listPlaylists() {
  const [me, playlists] = await Promise.all([api('/me'), paginate('/me/playlists?limit=50')]);
  return playlists.filter(Boolean).map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner?.display_name ?? p.owner?.id,
    total: p.items?.total ?? p.tracks?.total ?? null,
    image: p.images?.[0]?.url ?? null,
    // dev mode apps can only read playlists you own or collaborate on
    readable: p.owner?.id === me.id || p.collaborative,
  }));
}

export async function playlistTracks(playlistId) {
  const entries = await paginate(`/playlists/${playlistId}/items?limit=50&additional_types=track`);
  return entries.map((e) => toTrack(entryTrack(e), 'playlist')).filter(Boolean);
}

export async function likedTracks() {
  const entries = await paginate('/me/tracks?limit=50');
  return entries.map((e) => toTrack(entryTrack(e), 'liked')).filter(Boolean);
}

export async function topTracks() {
  const page = await api('/me/top/tracks?limit=50&time_range=medium_term');
  return page.items.map((t) => toTrack(t, 'top')).filter(Boolean);
}
