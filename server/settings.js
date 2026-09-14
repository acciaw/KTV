// everything the onboarding and /admin manage, stored in data/settings.json, secrets never sent back to the browser
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { writeJson } from './store.js';

const FILE = 'settings.json';
export const DEFAULT_OWNER = 'Acciaw';

const defaults = () => ({
  ownerName: null, // set by the first onboarding step
  onboarded: false,
  spotify: { clientId: '', clientSecret: '' },
  // music services besides spotify (services.js)
  services: {
    youtube: { clientId: '', clientSecret: '' },
    applemusic: { teamId: '', keyId: '', privateKey: '' },
    deezer: { userId: '', name: '' },
    lastfm: { username: '' },
  },
  keys: { lastfm: '', youtube: '' },
  lineup: {
    playlists: [],
    includeLiked: true,
    includeTop: false,
    includeLive: false,
    discoveryShare: 0.15,
    // what each other service adds to the lineup
    services: {
      youtube: { liked: true, playlists: [] },
      applemusic: { library: true, playlists: [] },
      deezer: { favorites: true, playlists: [] },
      lastfm: { loved: true, top: false },
    },
    // decades to keep, like { from: 1970, to: 1990 }, a null end is open
    eras: { from: null, to: null },
    excludedArtists: [],
  },
});

// each entry of base, with whatever the saved settings have for it on top
const mergeEach = (base, saved) => Object.fromEntries(Object.entries(base).map(([id, value]) => [id, { ...value, ...saved?.[id] }]));

function load() {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path.join(config.dataDir, FILE), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (Array.isArray(raw.playlists) && !raw.lineup) raw = { lineup: raw }; // before onboarding existed
  const base = defaults();
  return {
    ...base,
    ...raw,
    spotify: { ...base.spotify, ...raw.spotify },
    services: mergeEach(base.services, raw.services),
    keys: { ...base.keys, ...raw.keys },
    lineup: {
      ...base.lineup,
      ...raw.lineup,
      services: mergeEach(base.lineup.services, raw.lineup?.services),
      eras: { ...base.lineup.eras, ...raw.lineup?.eras },
    },
  };
}

let current = load();

export const getSettings = () => current;

export async function updateSettings(change) {
  const next = structuredClone(current);
  change(next);
  await writeJson(FILE, next);
  current = next;
  return next;
}

export const spotifyConfigured = () => Boolean(current.spotify.clientId && current.spotify.clientSecret);

// channel named after its owner, the logo letter is their initial: acciaw, k, ktv
export function channel() {
  const name = current.ownerName?.trim() || DEFAULT_OWNER;
  const [first] = new Intl.Segmenter().segment(name);
  return { name, letter: first.segment.toLocaleUpperCase() };
}
