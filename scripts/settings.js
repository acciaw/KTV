// back up, restore or wipe everything the onboarding and /admin manage, backups contain secrets and are gitignored
//   npm run settings -- export [file]
//   npm run settings -- import [file]
//   npm run settings -- reset
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { config } from '../server/config.js';

const FORMAT = 'ktv-settings/1';
const ENV_KEYS_MOVED_TO_ADMIN = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'LASTFM_API_KEY', 'YOUTUBE_API_KEY'];
// where each service keeps its login, by the name it has in a backup
const LOGIN_FILES = { spotifyTokens: 'spotify-tokens.json', youtubeTokens: 'youtube-tokens.json', appleMusicToken: 'applemusic-token.json' };
const [command, file = 'ktv-settings.backup.json'] = process.argv.slice(2);

const dataPath = (name) => path.join(config.dataDir, name);
const readData = (name) => (existsSync(dataPath(name)) ? JSON.parse(readFileSync(dataPath(name), 'utf8')) : null);
const hint = (secret) => (secret ? `saved, ending in …${secret.slice(-4)}` : 'not set');
const saved = (value) => (value ? 'saved' : 'not saved');

function currentSettings() {
  let settings = readData('settings.json') ?? {};
  if (Array.isArray(settings.playlists) && !settings.lineup) settings = { lineup: settings }; // before onboarding existed
  // older setups kept the spotify app and api keys in .env
  const env = existsSync('.env') ? dotenv.parse(readFileSync('.env')) : {};
  return {
    ...settings,
    ownerName: settings.ownerName ?? 'Acciaw',
    spotify: {
      clientId: settings.spotify?.clientId || env.SPOTIFY_CLIENT_ID || '',
      clientSecret: settings.spotify?.clientSecret || env.SPOTIFY_CLIENT_SECRET || '',
    },
    keys: {
      lastfm: settings.keys?.lastfm || env.LASTFM_API_KEY || '',
      youtube: settings.keys?.youtube || env.YOUTUBE_API_KEY || '',
    },
  };
}

// whether any music service is set up, which is what the onboarding leads to
function anyService(settings) {
  const { spotify, services = {} } = settings;
  return Boolean(
    (spotify?.clientId && spotify?.clientSecret) ||
    (services.youtube?.clientId && services.youtube?.clientSecret) ||
    (services.applemusic?.keyId && services.applemusic?.privateKey) ||
    services.deezer?.userId ||
    services.lastfm?.username,
  );
}

function describe(settings, logins) {
  const { lineup = {}, services = {} } = settings;
  const eras = lineup.eras ?? {};
  console.log(`  Channel name:         ${settings.ownerName}`);
  console.log(`  Spotify client ID:    ${settings.spotify.clientId || 'not set'}`);
  console.log(`  Spotify secret:       ${hint(settings.spotify.clientSecret)}`);
  console.log(`  Spotify login:        ${saved(logins.spotifyTokens?.refresh_token)}`);
  console.log(`  YouTube app:          ${services.youtube?.clientId || 'not set'}${services.youtube?.clientId ? `, secret ${hint(services.youtube.clientSecret)}` : ''}`);
  console.log(`  YouTube login:        ${saved(logins.youtubeTokens?.refresh_token)}`);
  console.log(`  Apple Music key:      ${services.applemusic?.keyId ? `${services.applemusic.keyId} (team ${services.applemusic.teamId}), private key ${services.applemusic.privateKey ? 'saved' : 'not set'}` : 'not set'}`);
  console.log(`  Apple Music sign-in:  ${saved(logins.appleMusicToken?.musicUserToken)}`);
  console.log(`  Deezer profile:       ${services.deezer?.userId ? `${services.deezer.name} (${services.deezer.userId})` : 'not set'}`);
  console.log(`  Last.fm user:         ${services.lastfm?.username || 'not set'}`);
  console.log(`  Last.fm key:          ${hint(settings.keys.lastfm)}`);
  console.log(`  YouTube key:          ${hint(settings.keys.youtube)}`);
  console.log(`  Liked songs:          ${lineup.includeLiked ? 'on' : 'off'}`);
  console.log(`  Top tracks:           ${lineup.includeTop ? 'on' : 'off'}`);
  console.log(`  Live performances:    ${lineup.includeLive ? 'on' : 'off'}`);
  console.log(`  Playlists:            ${lineup.playlists?.length ? lineup.playlists.join(', ') : 'none'}`);
  console.log(`  Discovery share:      ${Math.round((lineup.discoveryShare ?? 0) * 100)}%`);
  console.log(`  Eras:                 ${eras.from ?? 'any'} to ${eras.to ?? 'any'}`);
  console.log(`  Unchecked artists:    ${lineup.excludedArtists?.length ?? 0}`);
}

if (command === 'export') {
  const settings = currentSettings();
  const logins = Object.fromEntries(Object.entries(LOGIN_FILES).map(([name, dataFile]) => [name, readData(dataFile)]));
  writeFileSync(file, JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), settings, ...logins }, null, 2));
  console.log(`Saved to ${path.resolve(file)}:`);
  describe(settings, logins);
} else if (command === 'import') {
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  if (backup.format !== FORMAT) throw new Error(`${file} is not a KTV settings backup.`);
  mkdirSync(config.dataDir, { recursive: true });
  const settings = { ...backup.settings, onboarded: anyService(backup.settings) };
  writeFileSync(dataPath('settings.json'), JSON.stringify(settings, null, 2));
  for (const [name, dataFile] of Object.entries(LOGIN_FILES)) {
    if (backup[name]) writeFileSync(dataPath(dataFile), JSON.stringify(backup[name], null, 2));
  }
  rmSync(dataPath('library.json'), { force: true }); // rebuilt from the restored lineup
  console.log(`Restored from ${path.resolve(file)}:`);
  describe(settings, backup);
  console.log('Restart KTV (Ctrl+C, then npm run dev) to load them.');
} else if (command === 'reset') {
  for (const name of ['settings.json', ...Object.values(LOGIN_FILES), 'library.json']) {
    if (existsSync(dataPath(name))) {
      rmSync(dataPath(name));
      console.log(`Deleted data/${name}`);
    }
  }
  if (existsSync('.env')) {
    const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
    const kept = lines.filter((line) => !ENV_KEYS_MOVED_TO_ADMIN.some((key) => line.startsWith(`${key}=`)));
    if (kept.length !== lines.length) {
      writeFileSync('.env', kept.join('\n'));
      console.log(`Removed ${lines.length - kept.length} key(s) from .env (the Spotify app and API keys now live in /admin)`);
    }
  }
  console.log('Restart KTV (Ctrl+C, then npm run dev). The onboarding starts on the next visit.');
} else {
  console.error('Usage: npm run settings -- export [file] | import [file] | reset');
  process.exit(1);
}
