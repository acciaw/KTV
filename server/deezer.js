// your deezer profile as a music service, read through deezer's public api, the profile just needs to be public
import { getSettings } from './settings.js';

const API = 'https://api.deezer.com';
const MAX_ITEMS = 10000;

export const deezerConfigured = () => Boolean(getSettings().services.deezer.userId);

async function get(url) {
  const res = await fetch(url.startsWith('https://') ? url : `${API}${url}`);
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(data.error.message === 'no data' ? 'Deezer has nothing public there' : data.error.message);
  if (!res.ok) throw new Error(`Deezer answered ${res.status}`);
  return data;
}

async function paginate(path) {
  const items = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}limit=100`;
  while (next && items.length < MAX_ITEMS) {
    const page = await get(next);
    items.push(...(page.data ?? []));
    next = page.next ?? null;
  }
  return items;
}

// the profile behind a link or share link, or its bare number
export async function findDeezerProfile(input) {
  let text = String(input ?? '').trim();
  // share links redirect to the profile page, whose address has the number
  if (/^https?:\/\/(?:link\.deezer\.com|deezer\.page\.link)\//i.test(text)) text = (await fetch(text, { redirect: 'follow' })).url;
  const id = text.match(/profile\/(\d+)/)?.[1] ?? text.match(/^\d+$/)?.[0];
  if (!id) throw new Error('Paste the link to your Deezer profile, or its number.');
  const user = await get(`/user/${id}`);
  return { userId: String(user.id), name: user.name ?? '' };
}

export async function deezerPlaylists() {
  const { userId } = getSettings().services.deezer;
  return (await paginate(`/user/${userId}/playlists`)).map((p) => ({
    id: String(p.id),
    name: p.title || 'Untitled',
    owner: p.creator?.name ?? '',
    total: p.nb_tracks ?? null,
    image: p.picture_medium ?? null,
    readable: true,
  }));
}

function toTrack(t, source) {
  if (!t?.title || !t.artist?.name) return null;
  return {
    key: `deezer:${t.id}`,
    title: t.title,
    artists: [t.artist.name],
    album: t.album?.title ?? null,
    albumType: null,
    year: null,
    durationMs: t.duration ? t.duration * 1000 : null,
    image: t.album?.cover_medium ?? null,
    source,
  };
}

export async function deezerTracks({ favorites, playlists = [] }) {
  const { userId } = getSettings().services.deezer;
  const tracks = [];
  if (favorites) tracks.push(...(await paginate(`/user/${userId}/tracks`)).map((t) => toTrack(t, 'deezer-favorites')));
  for (const id of playlists) {
    const items = await paginate(`/playlist/${id}/tracks`).catch((err) => {
      console.warn(`Skipping Deezer playlist ${id}: ${err.message}`);
      return [];
    });
    tracks.push(...items.map((t) => toTrack(t, 'deezer-playlist')));
  }
  return tracks.filter(Boolean);
}
