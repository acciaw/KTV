import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { appleMusicConfigured, checkAppleMusicKey, connectAppleMusic, developerToken, disconnectAppleMusic, tidyPrivateKey } from './applemusic.js';
import { config } from './config.js';
import { findDeezerProfile } from './deezer.js';
import { clearHistory, historyPage, historyStats, recordPlay } from './history.js';
import { checkLastfmKey, checkLastfmUser } from './lastfm.js';
import { libraryInfo, lineupOverview, nextItem, refreshLibrary, saveLineup } from './library.js';
import { SERVICES, anyServiceConfigured, connectedServices, servicesStatus } from './services.js';
import { DEFAULT_OWNER, channel, getSettings, spotifyConfigured, updateSettings } from './settings.js';
import { NotConnectedError, authorizeUrl, checkAppCredentials, disconnect, exchangeCode, isConnected, listPlaylists, redirectUri } from './spotify.js';
import { checkYoutubeClient, disconnectYoutube, exchangeYoutubeCode, youtubeAuthorizeUrl, youtubeConfigured } from './youtube-account.js';
import { checkYoutubeKey, reportPlayback } from './youtube.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim().split('=')).filter(([name]) => name).map(([name, ...rest]) => [name, decodeURIComponent(rest.join('='))]),
  );
}

const secureCookies = config.baseUrl.startsWith('https://');

// youtube's embedded player refuses to play (errors 150/153) when it can't tell which site embeds it
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// optional shared secret so strangers on your domain can't tune in or touch settings
app.use((req, res, next) => {
  if (!config.accessKey) return next();
  if (req.query.key === config.accessKey) {
    res.cookie('ktv_key', config.accessKey, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: 400 * 24 * 3600_000 });
    return next();
  }
  if (parseCookies(req.headers.cookie).ktv_key === config.accessKey) return next();
  res.status(401).type('text').send('KTV is off the air.');
});

const page = (name) => (req, res) => res.sendFile(path.join(config.publicDir, name));

// until the channel is set up there's nothing to play, so the tv sends visitors to the onboarding in /admin
function requireSetup(req, res, next) {
  if (getSettings().onboarded && (spotifyConfigured() || anyServiceConfigured())) return next();
  res.redirect('/admin');
}

// youtube refuses most label videos on a page opened by ip address, so a tv on 127.0.0.1 moves to localhost, spotify login keeps base_url which must stay 127.0.0.1
function loopbackToLocalhost(req, res, next) {
  if (!['127.0.0.1', '[::1]', '::1'].includes(req.hostname)) return next();
  const port = req.get('host').match(/:(\d+)$/)?.[1];
  const target = new URL(req.originalUrl, `http://localhost${port ? `:${port}` : ''}`);
  if (config.accessKey) target.searchParams.set('key', config.accessKey); // cookies don't carry across hosts
  res.redirect(target.href);
}

app.get('/', (req, res) => res.redirect('/tv'));
app.get('/tv', requireSetup, loopbackToLocalhost, page('tv.html'));
app.get('/admin', page('admin.html'));
app.get('/admin/stats', page('admin.html'));
app.use(express.static(config.publicDir, { index: false }));

app.get('/auth/login', (req, res) => {
  if (!spotifyConfigured()) return res.redirect('/admin');
  // state cookie must be set on the same host spotify redirects back to
  const base = new URL(config.baseUrl);
  if (req.get('host') !== base.host) {
    const key = config.accessKey ? `?key=${encodeURIComponent(config.accessKey)}` : '';
    return res.redirect(`${config.baseUrl}/auth/login${key}`);
  }
  const state = crypto.randomUUID();
  res.cookie('ktv_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: 10 * 60_000 });
  res.redirect(authorizeUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = parseCookies(req.headers.cookie).ktv_oauth_state;
  res.clearCookie('ktv_oauth_state');
  const fail = (reason) => res.redirect(`/admin?spotify_error=${encodeURIComponent(reason)}`);
  if (error) return fail(error === 'access_denied' ? 'You declined the Spotify login.' : error);
  if (!code || !state || state !== expected) return fail('The Spotify login expired. Try again.');
  try {
    await exchangeCode(code);
  } catch (err) {
    return fail(err.message);
  }
  res.redirect('/admin');
});

// google login for a youtube account works like the spotify one, same host rule, its own state cookie
app.get('/auth/youtube/login', (req, res) => {
  if (!youtubeConfigured()) return res.redirect('/admin');
  const base = new URL(config.baseUrl);
  if (req.get('host') !== base.host) {
    const key = config.accessKey ? `?key=${encodeURIComponent(config.accessKey)}` : '';
    return res.redirect(`${config.baseUrl}/auth/youtube/login${key}`);
  }
  const state = crypto.randomUUID();
  res.cookie('ktv_youtube_state', state, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: 10 * 60_000 });
  res.redirect(youtubeAuthorizeUrl(state));
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = parseCookies(req.headers.cookie).ktv_youtube_state;
  res.clearCookie('ktv_youtube_state');
  const fail = (reason) => res.redirect(`/admin?service=youtube&service_error=${encodeURIComponent(reason)}`);
  if (error) return fail(error === 'access_denied' ? 'You declined the Google login.' : error);
  if (!code || !state || state !== expected) return fail('The Google login expired. Try again.');
  try {
    await exchangeYoutubeCode(code);
  } catch (err) {
    return fail(err.message);
  }
  res.redirect('/admin?service=youtube');
});

app.get('/api/config', (req, res) => res.json({ maxClipSeconds: config.maxClipSeconds, endCutSeconds: config.endCutSeconds, channel: channel() }));

// everything /admin needs, secrets are reported as saved or not, never sent back
app.get('/api/status', async (req, res) => {
  const settings = getSettings();
  res.json({
    onboarded: settings.onboarded,
    ownerName: settings.ownerName,
    channel: channel(),
    spotify: {
      clientId: settings.spotify.clientId,
      secretSaved: Boolean(settings.spotify.clientSecret),
      configured: spotifyConfigured(),
      connected: await isConnected(),
      redirectUri: redirectUri(),
    },
    services: await servicesStatus(),
    keys: { lastfm: Boolean(settings.keys.lastfm), youtube: Boolean(settings.keys.youtube) },
    lineup: settings.lineup,
    library: libraryInfo(),
  });
});

app.put('/api/channel', async (req, res) => {
  const name = typeof req.body?.ownerName === 'string' ? req.body.ownerName.trim().slice(0, 40) : '';
  await updateSettings((settings) => { settings.ownerName = name || DEFAULT_OWNER; });
  res.json(channel());
});

// saves the spotify app once spotify confirms the id and secret, an empty secret keeps the saved one
app.put('/api/spotify', async (req, res) => {
  const saved = getSettings().spotify;
  const clientId = String(req.body?.clientId ?? '').trim();
  const clientSecret = String(req.body?.clientSecret ?? '').trim() || saved.clientSecret;
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'Enter both the client ID and the client secret.' });
  try {
    await checkAppCredentials({ clientId, clientSecret });
  } catch (err) {
    return res.status(400).json({ error: `Spotify rejected these credentials (${err.message}).` });
  }
  if (clientId !== saved.clientId) await disconnect(); // a Spotify login belongs to one app
  await updateSettings((settings) => { settings.spotify = { clientId, clientSecret }; });
  res.json({ ok: true });
});

app.delete('/api/spotify', async (req, res) => {
  await disconnect();
  await updateSettings((settings) => { settings.spotify = { clientId: '', clientSecret: '' }; });
  res.status(204).end();
});

// other music services, each set up the way spotify is: saved once confirmed, a new app or key signs the account out, an empty secret keeps the saved one

app.put('/api/services/youtube', async (req, res) => {
  const saved = getSettings().services.youtube;
  const clientId = String(req.body?.clientId ?? '').trim();
  const clientSecret = String(req.body?.clientSecret ?? '').trim() || saved.clientSecret;
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'Enter both the client ID and the client secret.' });
  try {
    await checkYoutubeClient({ clientId, clientSecret });
  } catch (err) {
    return res.status(400).json({ error: `Google rejected these credentials (${err.message}).` });
  }
  if (clientId !== saved.clientId) await disconnectYoutube();
  await updateSettings((settings) => { settings.services.youtube = { clientId, clientSecret }; });
  res.json({ ok: true });
});

app.delete('/api/services/youtube', async (req, res) => {
  await disconnectYoutube();
  await updateSettings((settings) => { settings.services.youtube = { clientId: '', clientSecret: '' }; });
  res.status(204).end();
});

app.put('/api/services/applemusic', async (req, res) => {
  const saved = getSettings().services.applemusic;
  const teamId = String(req.body?.teamId ?? '').trim();
  const keyId = String(req.body?.keyId ?? '').trim();
  const privateKey = tidyPrivateKey(req.body?.privateKey) || saved.privateKey;
  if (!teamId || !keyId || !privateKey) return res.status(400).json({ error: 'Enter the team ID, the key ID and the private key.' });
  try {
    await checkAppleMusicKey({ teamId, keyId, privateKey });
  } catch (err) {
    return res.status(400).json({ error: `Apple Music rejected this key (${err.message}).` });
  }
  if (teamId !== saved.teamId || keyId !== saved.keyId) await disconnectAppleMusic();
  await updateSettings((settings) => { settings.services.applemusic = { teamId, keyId, privateKey }; });
  res.json({ ok: true });
});

// musickit on the admin page needs a developer token to sign in with
app.get('/api/services/applemusic/developer-token', (req, res) => {
  if (!appleMusicConfigured()) return res.status(409).json({ error: 'Save the Apple Music key first.' });
  res.json({ developerToken: developerToken() });
});

app.post('/api/services/applemusic/connect', async (req, res) => {
  const musicUserToken = String(req.body?.musicUserToken ?? '');
  if (!musicUserToken) return res.status(400).json({ error: 'The Apple Music sign-in returned nothing.' });
  try {
    await connectAppleMusic(musicUserToken);
  } catch (err) {
    return res.status(400).json({ error: `Apple Music refused the sign-in (${err.message}).` });
  }
  res.json({ ok: true });
});

app.delete('/api/services/applemusic', async (req, res) => {
  await disconnectAppleMusic();
  await updateSettings((settings) => { settings.services.applemusic = { teamId: '', keyId: '', privateKey: '' }; });
  res.status(204).end();
});

app.put('/api/services/deezer', async (req, res) => {
  let profile;
  try {
    profile = await findDeezerProfile(req.body?.profile);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await updateSettings((settings) => { settings.services.deezer = profile; });
  res.json(profile);
});

app.delete('/api/services/deezer', async (req, res) => {
  await updateSettings((settings) => { settings.services.deezer = { userId: '', name: '' }; });
  res.status(204).end();
});

app.put('/api/services/lastfm', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  if (!username) return res.status(400).json({ error: 'Enter your Last.fm username.' });
  if (!getSettings().keys.lastfm) return res.status(400).json({ error: 'Add a Last.fm API key first.' });
  let user;
  try {
    user = await checkLastfmUser(username);
  } catch (err) {
    return res.status(400).json({ error: `Last.fm couldn't find this user (${err.message}).` });
  }
  await updateSettings((settings) => { settings.services.lastfm = { username: user.name }; });
  res.json({ username: user.name });
});

app.delete('/api/services/lastfm', async (req, res) => {
  await updateSettings((settings) => { settings.services.lastfm = { username: '' }; });
  res.status(204).end();
});

app.get('/api/services/:id/playlists', async (req, res) => {
  const service = SERVICES[req.params.id];
  if (!service?.playlists) return res.status(404).json({ error: 'This service has no playlists.' });
  res.json(await service.playlists());
});

const KEY_CHECKS = {
  lastfm: { label: 'Last.fm', check: checkLastfmKey },
  youtube: { label: 'YouTube', check: checkYoutubeKey },
};

// optional api keys, a string is checked and saved, null removes the key, a missing field leaves it alone
app.put('/api/keys', async (req, res) => {
  const changes = {};
  for (const [name, { label, check }] of Object.entries(KEY_CHECKS)) {
    const value = req.body?.[name];
    if (value === undefined) continue;
    const key = String(value ?? '').trim();
    if (key) {
      try {
        await check(key);
      } catch (err) {
        return res.status(400).json({ error: `${label} rejected this key (${err.message}).` });
      }
    }
    changes[name] = key;
  }
  await updateSettings((settings) => { Object.assign(settings.keys, changes); });
  const { keys } = getSettings();
  res.json({ lastfm: Boolean(keys.lastfm), youtube: Boolean(keys.youtube) });
});

app.get('/api/playlists', async (req, res) => res.json(await listPlaylists()));
app.put('/api/lineup', async (req, res) => res.json(await saveLineup(req.body)));
app.get('/api/lineup/overview', async (req, res) => res.json(await lineupOverview()));
app.post('/api/library/refresh', async (req, res) => res.json(await refreshLibrary()));

// whether the lineup has at least one source on a connected service
async function hasSources(lineup) {
  if ((await isConnected()) && (lineup.includeLiked || lineup.includeTop || lineup.playlists.length)) return true;
  for (const id of await connectedServices()) {
    if (Object.values(lineup.services[id]).some((value) => (Array.isArray(value) ? value.length > 0 : value === true))) return true;
  }
  return false;
}

// last onboarding step, save the lineup, build it once, put the channel on air
app.post('/api/onboarding/finish', async (req, res) => {
  const lineup = await saveLineup(req.body);
  if (!(await hasSources(lineup))) {
    return res.status(400).json({ error: 'Pick at least one source for the lineup.' });
  }
  const library = await refreshLibrary();
  await updateSettings((settings) => { settings.onboarded = true; });
  res.json(library);
});

// session identifies one tv page load, so songs don't repeat within it
app.get('/api/next', async (req, res) => res.json(await nextItem(String(req.query.session ?? 'default').slice(0, 64))));

app.post('/api/report', async (req, res) => {
  await reportPlayback(req.body ?? {});
  res.status(204).end();
});

// listen history, the tv reports each clip as it ends, the stats page reads it back
app.post('/api/played', async (req, res) => {
  await recordPlay(req.body ?? {});
  res.status(204).end();
});
app.get('/api/stats', async (req, res) => res.json(await historyStats({ timeZone: String(req.query.tz ?? '') })));
app.get('/api/history', async (req, res) => res.json(await historyPage({ before: req.query.before, limit: req.query.limit })));
app.delete('/api/history', async (req, res) => {
  await clearHistory();
  res.status(204).end();
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err instanceof NotConnectedError ? 409 : 500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`KTV standing by on port ${config.port}`);
  console.log(`  TV:    ${config.baseUrl}/tv`);
  console.log(`  Admin: ${config.baseUrl}/admin`);
});
