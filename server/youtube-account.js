// your youtube account as a music service, liked videos and playlists read with the youtube data api
import { config } from './config.js';
import { getSettings } from './settings.js';
import { readJson, removeJson, writeJson } from './store.js';

const TOKEN_FILE = 'youtube-tokens.json';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const API = 'https://www.googleapis.com/youtube/v3';
// videos read per source at most, each page of 50 costs one unit of the api's daily 10000
const MAX_ITEMS = 5000;
const MUSIC_CATEGORY = '10';

export const youtubeRedirectUri = () => `${config.baseUrl}/auth/youtube/callback`;

export function youtubeConfigured() {
  const { clientId, clientSecret } = getSettings().services.youtube;
  return Boolean(clientId && clientSecret);
}

export function youtubeAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: getSettings().services.youtube.clientId,
    redirect_uri: youtubeRedirectUri(),
    response_type: 'code',
    scope: SCOPE,
    // refresh token so the lineup can be rebuilt later without logging in again
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body, { clientId, clientSecret } = getSettings().services.youtube) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Google answered ${res.status}`);
    err.code = data.error;
    throw err;
  }
  return data;
}

// google has no app only login to test with, a made up code answers invalid_grant for a real client and invalid_client for a wrong one
export async function checkYoutubeClient(credentials) {
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: 'ktv-check', redirect_uri: youtubeRedirectUri() }, credentials);
  } catch (err) {
    if (!err.code || err.code === 'invalid_client' || err.code === 'unauthorized_client') throw err;
  }
}

async function saveTokens(response, previous = {}) {
  const tokens = {
    access_token: response.access_token,
    // refresh responses leave refresh_token out, the old one stays valid then
    refresh_token: response.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (response.expires_in - 60) * 1000,
  };
  await writeJson(TOKEN_FILE, tokens);
  return tokens;
}

export async function exchangeYoutubeCode(code) {
  await saveTokens(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: youtubeRedirectUri() }));
}

export const youtubeConnected = async () => Boolean((await readJson(TOKEN_FILE, null))?.refresh_token);
export const disconnectYoutube = () => removeJson(TOKEN_FILE);

let refreshing = null;

async function accessToken() {
  const tokens = await readJson(TOKEN_FILE, null);
  if (!tokens?.refresh_token) throw new Error('YouTube is not connected.');
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    .then((response) => saveTokens(response, tokens))
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

async function api(resource, params) {
  const res = await fetch(`${API}/${resource}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`YouTube ${res.status} on ${resource}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function paginate(resource, params) {
  const items = [];
  let pageToken = '';
  do {
    const page = await api(resource, { ...params, maxResults: '50', ...(pageToken && { pageToken }) });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && items.length < MAX_ITEMS);
  return items;
}

export async function youtubePlaylists() {
  const playlists = await paginate('playlists', { part: 'snippet,contentDetails', mine: 'true' });
  return playlists.map((p) => ({
    id: p.id,
    name: p.snippet?.title || 'Untitled',
    owner: p.snippet?.channelTitle ?? '',
    total: p.contentDetails?.itemCount ?? null,
    image: p.snippet?.thumbnails?.medium?.url ?? p.snippet?.thumbnails?.default?.url ?? null,
    readable: true,
  }));
}

// "PT3M45S" becomes 225000
function durationMs(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!match) return null;
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 || null;
}

// "(Official Video)", "[Official Music Video]", "(Lyrics)", "[4K Remaster]"
const VIDEO_TAG = /\s*[([][^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|m\/?v|clip|remaster(?:ed)?)\b[^)\]]*[)\]]/giu;

// a saved video as a song, "Artist - Topic" uploads are already clean, other titles mostly read "Artist - Song (Official Video)"
export function videoToTrack({ videoId, title, channel = '', durationMs: length = null, image = null }, source) {
  if (!videoId || !title || /^(?:deleted|private) video$/i.test(title)) return null;
  const topic = /^(.+?)\s+-\s+Topic$/u.exec(channel ?? '');
  const parts = title.split(/\s+[-–—]\s+/u);
  let artist;
  let song;
  if (topic) {
    [artist, song] = [topic[1], title];
  } else if (parts.length >= 2) {
    [artist, song] = [parts[0], parts.slice(1).join(' - ')];
  } else {
    [artist, song] = [(channel ?? '').replace(/VEVO$|\s*Official$/iu, ''), title];
  }
  // "Calvin Harris x Dua Lipa" or "Artist ft. Guest": artists named first, featured guests left out
  const artists = artist.replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/iu, '').split(/\s+x\s+/iu).map((name) => name.trim()).filter(Boolean);
  // "Song ft. Guest" becomes "Song (feat. Guest)", the way spotify writes it, so names match the same way
  song = song.replace(VIDEO_TAG, '').replace(/\s*\|.*$/u, '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu, ' (feat. $1)').trim();
  if (!artists.length || !song) return null;
  return { key: `youtube:${videoId}`, title: song, artists, album: null, albumType: null, year: null, durationMs: length, image, source };
}

export async function youtubeTracks({ liked, playlists = [] }) {
  const tracks = [];
  if (liked) {
    for (const video of await paginate('videos', { part: 'snippet,contentDetails', myRating: 'like' })) {
      // likes are full of everything else too, only videos youtube files under music
      if (video.snippet?.categoryId !== MUSIC_CATEGORY) continue;
      const { title, channelTitle, thumbnails } = video.snippet;
      tracks.push(videoToTrack({ videoId: video.id, title, channel: channelTitle, durationMs: durationMs(video.contentDetails?.duration), image: thumbnails?.high?.url }, 'youtube-liked'));
    }
  }
  for (const playlistId of playlists) {
    const items = await paginate('playlistItems', { part: 'snippet,contentDetails', playlistId }).catch((err) => {
      console.warn(`Skipping YouTube playlist ${playlistId}: ${err.message}`);
      return [];
    });
    for (const item of items) {
      const { title, videoOwnerChannelTitle, thumbnails } = item.snippet ?? {};
      tracks.push(videoToTrack({ videoId: item.contentDetails?.videoId, title, channel: videoOwnerChannelTitle, image: thumbnails?.high?.url }, 'youtube-playlist'));
    }
  }
  return tracks.filter(Boolean);
}
