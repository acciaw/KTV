// music services besides spotify that can feed the lineup, spotify has its own module (spotify.js)
import { appleMusicConfigured, appleMusicConnected, appleMusicPlaylists, appleMusicTracks } from './applemusic.js';
import { deezerConfigured, deezerPlaylists, deezerTracks } from './deezer.js';
import { lastfmEnabled, lastfmUserTracks } from './lastfm.js';
import { getSettings } from './settings.js';
import { youtubeConfigured, youtubeConnected, youtubePlaylists, youtubeRedirectUri, youtubeTracks } from './youtube-account.js';

const lastfmConfigured = () => Boolean(getSettings().services.lastfm.username);

// configured: set up in /admin, connected: songs can be read now, playlists: null if none
export const SERVICES = {
  youtube: { name: 'YouTube', configured: youtubeConfigured, connected: youtubeConnected, playlists: youtubePlaylists, tracks: youtubeTracks },
  applemusic: { name: 'Apple Music', configured: appleMusicConfigured, connected: appleMusicConnected, playlists: appleMusicPlaylists, tracks: appleMusicTracks },
  deezer: { name: 'Deezer', configured: deezerConfigured, connected: async () => deezerConfigured(), playlists: deezerPlaylists, tracks: deezerTracks },
  lastfm: { name: 'Last.fm', configured: lastfmConfigured, connected: async () => lastfmConfigured() && lastfmEnabled(), playlists: null, tracks: lastfmUserTracks },
};

export const anyServiceConfigured = () => Object.values(SERVICES).some((service) => service.configured());

export async function connectedServices() {
  const ids = [];
  for (const [id, service] of Object.entries(SERVICES)) {
    if (await service.connected()) ids.push(id);
  }
  return ids;
}

// what /admin shows about each service, secrets only say whether they're saved
export async function servicesStatus() {
  const { services, keys } = getSettings();
  return {
    youtube: {
      configured: youtubeConfigured(),
      connected: await youtubeConnected(),
      clientId: services.youtube.clientId,
      secretSaved: Boolean(services.youtube.clientSecret),
      redirectUri: youtubeRedirectUri(),
    },
    applemusic: {
      configured: appleMusicConfigured(),
      connected: await appleMusicConnected(),
      teamId: services.applemusic.teamId,
      keyId: services.applemusic.keyId,
      keySaved: Boolean(services.applemusic.privateKey),
    },
    deezer: { configured: deezerConfigured(), connected: deezerConfigured(), userId: services.deezer.userId, name: services.deezer.name },
    lastfm: { configured: lastfmConfigured(), connected: lastfmConfigured() && Boolean(keys.lastfm), username: services.lastfm.username, keySaved: Boolean(keys.lastfm) },
  };
}
