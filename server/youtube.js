// turns a track into a clip, its official music video or a live version when live is on, every candidate gets checked against the real video before it can air, results are cached per song
import sharp from 'sharp';
import { Innertube, Log } from 'youtubei.js';
import { getSettings } from './settings.js';
import { readJson, writeJson } from './store.js';
import { baseTitle, compact, nameKey, normalize } from './text.js';

const CACHE_FILE = 'youtube-cache.json';
// bump when the matching rules change, so every song is searched again under the new rules
const CACHE_VERSION = 5;
const RESEARCH_AFTER_MS = 30 * 24 * 3600_000;
const RETRY_NOT_FOUND_MS = 3 * 24 * 3600_000;
const MAX_CANDIDATES = 8;
// player errors that mean this video will never play embedded: invalid id, removed or private, embedding disabled
const PERMANENT_ERRORS = new Set(['yt-2', 'yt-100', 'yt-101', 'yt-150']);
// when a tv fails several different videos in a row, the tv is the problem, not the videos
const MAX_TRUSTED_STREAK = 2;
// verdict on a video a tv couldn't play, other verdicts get made again on a re-search but the server can't check this one itself so it stays
const REFUSED = 'refused to play embedded';
// youtube music labels videos: omv is an official upload, ugc a user upload, atv a still image album track, official audio and lyric uploads get labeled omv too which is why every candidate gets checked against the real video
const OFFICIAL_MUSIC_VIDEO = 'MUSIC_VIDEO_TYPE_OMV';
// a storyboard frame counts as the same picture when its mean gray level difference from the video's typical frame stays under this, still album art uploads stay near 1 on 80% of their frames, real clips above 16
const STILL_DIFFERENCE = 4;

// channels whose live performances are official sessions or broadcasts (lowercase, no spaces or accents)
const LIVE_CHANNELS = new Set([
  'bbcmusic', 'bbcradio1', 'bbcradio2', 'bbcradio6music', 'laterwithjoolsholland', 'triplej', 'nprmusic', 'kexp',
  'colors', 'colorsxstudios', 'audiotreelive', 'austincitylimits', 'saturdaynightlive', 'thetonightshowstarringjimmyfallon',
  'thelateshowwithstephencolbert', 'jimmykimmellive', 'thelatelateshowwithjamescorden', 'latenightwithsethmeyers',
  'lablogotheque', 'mahoganysessions', 'sofarsounds', 'kcrw', 'wfuv', 'thecurrent', 'pastemagazine', 'vevo', 'mtv',
  'mtvunplugged', 'glastonburyfestival', 'coachella', 'lollapalooza', 'primaverasound', 'montreuxjazzfestival',
  'spotify', 'applemusic', 'deezer', 'arteconcert', 'taratata', 'franceinter', 'fip', 'radionova', 'quotidien', 'mouv',
]);
// title words that mark a live performance, a live pick needs one and a music video can't have any
const LIVE_WORDS = [
  'live', 'session', 'sessions', 'unplugged', 'tiny desk', 'live lounge', 'like a version', 'in concert', 'a colors show',
  'take away show', 'sofar', 'jools holland', 'tonight show', 'late show', 'late late show', 'late night', 'kimmel', 'snl',
  'glastonbury', 'coachella', 'lollapalooza', 'primavera sound', 'taratata',
];
const LIVE_MARKER = new RegExp(`\\b(${LIVE_WORDS.join('|')})\\b`);

const phrases = (list) => list.map((phrase) => ({ phrase, pattern: new RegExp(`\\b${phrase}\\b`) }));
// uploads that aren't the clip itself
const REJECT = phrases([
  'react', 'reacts', 'reacted', 'reacting', 'reaction', 'reactions', 'reaccion', 'reacciona', 'reagindo',
  'first time', 'first listen', 'hears', 'hearing', 'listens', 'listening', 'review', 'reviews', 'breakdown', 'breaks down',
  'explained', 'analysis', 'vocal coach', 'podcast', 'interview', 'behind the scenes', 'making of', 'documentary',
  'commentary', 'track by track', 'announcement', 'teaser', 'trailer', 'snippet', 'preview',
  'lyric', 'lyrics', 'letra', 'legendado', 'legendada', 'paroles', 'traduccion', 'traducao', 'subtitulado',
  'visualizer', 'visualiser', 'karaoke', 'sing along', 'sing a long', 'cover', 'covers', 'instrumental', 'tutorial',
  'lesson', 'how to play', 'piano', 'guitar', 'drum', 'rehearsal', 'dance practice', 'choreography',
  'remix', 'mashup', 'nightcore', '8d', 'sped up', 'slowed', 'reverb', 'bass boosted', 'extended',
  'hour', 'hours', 'loop', 'fan made', 'fanmade', 'fancam', 'fan cam', 'front row', 'pov', 'multicam', 'parody',
  'shorts', 'tiktok', 'vertical', 'full album', 'album stream', 'full concert', 'full show', 'full set', 'full performance',
  'audio only',
]);
// not the music video either, though fine in a live pick
const ACOUSTIC = phrases(['acoustic']);
const LIVE_PHRASES = phrases(LIVE_WORDS);
// fine on the artist's own channel, where it's the artist's own recording of someone else's song
const COVER_PHRASES = new Set(['cover', 'covers']);

// "Official Video", "Official Music Video", "Official 4K Remastered Music Video", "Video Oficial", "Clip Officiel"...
const OFFICIAL_VIDEO = /\bofficial( \w+){0,3} video\b|\bvideo oficial\b|\bclip officiel\b|\boffizielles (musik)?video\b/;
const MUSIC_VIDEO = /\b(music video|videoclip|video clip|mv)\b/;

// youtubei.js warns about every response field it doesn't know yet, ktv reports its own failures
Log.setLevel(Log.Level.NONE);

let cache = null;
let saveTimer = null;
let clientPromise = null;

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
    writeJson(CACHE_FILE, { version: CACHE_VERSION, entries: cache }).catch((err) => console.error('Saving YouTube cache failed:', err));
  }, 1000);
}

function client() {
  clientPromise ??= Innertube.create({ retrieve_player: false }).catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

// text rules

function hasSong(title, track) {
  const song = normalize(baseTitle(track.title));
  return !song || normalize(title).includes(song);
}

// a phrase is fine when the artist or track name has it too, except live tags on the track: a live recording on spotify still gets the official music video
function rejectedPhrase(title, track, kind, { artistChannel = false } = {}) {
  const artists = track.artists.join(' ');
  const context = normalize(`${artists} ${track.title}`);
  const rules = [[REJECT, context]];
  if (kind === 'video') rules.push([ACOUSTIC, context], [LIVE_PHRASES, normalize(`${artists} ${baseTitle(track.title)}`)]);
  for (const [list, allowed] of rules) {
    for (const { phrase, pattern } of list) {
      if (artistChannel && COVER_PHRASES.has(phrase)) continue;
      if (pattern.test(title) && !pattern.test(allowed)) return phrase;
    }
  }
  // "(Audio)" and "Official Audio" are a song over a picture, "Official Video [HD Audio]" is still a video
  if (/\baudio\b/.test(title) && !/\bvideo\b/.test(title) && !/\baudio\b/.test(context)) return 'audio';
  return null;
}

// the artist's own channel, like "Arctic Monkeys" or "TheWeekndVEVO", fan channels that merely contain the name don't count unless youtube marks the channel as the artist's
function isArtistChannel(channel, track, verifiedArtist = false) {
  const artist = nameKey(track.artists[0]);
  const name = nameKey(channel);
  const bare = name.replace(/^official/, '').replace(/(vevo|official|channel|music|tv)+$/, '');
  return name === artist || bare === artist || bare === `the${artist}` || (verifiedArtist && name.includes(artist));
}

// youtube music credits the artists itself, any of the track's artists will do
function creditsArtist(video, track) {
  const credited = video.artists.map(nameKey);
  const wanted = track.artists.map(nameKey);
  return credited.some((name) => wanted.some((artist) => name.includes(artist))) || compact(video.title).includes(wanted[0]);
}

function lengthPenalty(seconds, track, { shorter, longer }) {
  if (!seconds || !track.durationMs) return 0;
  const diff = seconds - track.durationMs / 1000;
  return (diff < -shorter ? 3 : 0) + (diff > longer ? 3 : 0);
}

// searches, and a first cheap pass over their results, each rating returns { score } or { rejected: reason }, the real video gets checked later (see checkClip)

async function searchMusicVideos(query) {
  const yt = await client();
  const results = await yt.music.search(query, { type: 'video' });
  return (results.contents ?? [])
    .filter((section) => section.type === 'MusicShelf')
    .flatMap((shelf) => shelf.contents ?? [])
    .filter((item) => item.id && item.item_type === 'video')
    .map((item) => {
      const artists = (item.artists ?? item.authors ?? []).map((artist) => artist.name);
      return {
        id: item.id,
        title: item.title ?? '',
        artists,
        channel: artists.join(', '),
        seconds: item.duration?.seconds || null,
        videoType: item.flex_columns?.at(0)?.title?.runs?.at(0)?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? 'unknown',
      };
    });
}

async function searchKeyless(query) {
  const yt = await client();
  const search = await yt.search(query, { type: 'video' });
  return search.videos
    .filter((v) => v.type === 'Video')
    .map((v) => ({
      id: v.video_id,
      title: v.title.toString(),
      channel: v.author?.name ?? '',
      seconds: v.duration?.seconds || null,
      verifiedArtist: Boolean(v.author?.is_verified_artist),
    }));
}

const decodeEntities = (s) => s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e) => ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' })[e]);

async function searchDataApi(query, apiKey) {
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q: query, key: apiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) throw new Error(`YouTube Data API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.items.map((i) => ({ id: i.id.videoId, title: decodeEntities(i.snippet.title), channel: i.snippet.channelTitle, seconds: null, verifiedArtist: false }));
}

async function search(query) {
  try {
    return await searchKeyless(query);
  } catch (err) {
    const apiKey = getSettings().keys.youtube;
    if (!apiKey) throw err;
    console.warn(`Keyless YouTube search failed (${err.message}), using the Data API.`);
    return searchDataApi(query, apiKey);
  }
}

// checks a data api key with the cheapest request there is (1 quota unit)
export async function checkYoutubeKey(apiKey) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'id', id: 'dQw4w9WgXcQ', key: apiKey })}`);
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error?.message || `YouTube answered ${res.status}`);
}

// youtube music titles are label metadata, not the videos' real titles, so here phrases only push a result down
function rateMusic(video, track) {
  if (video.videoType !== OFFICIAL_MUSIC_VIDEO) return { rejected: 'not an official upload' };
  if (!hasSong(video.title, track)) return { rejected: 'title lacks the song name' };
  if (!creditsArtist(video, track)) return { rejected: 'not by the artist' };
  if (video.seconds && (video.seconds < 60 || video.seconds > 1200)) return { rejected: 'wrong length' };
  const title = normalize(video.title);
  let score = 5;
  if (rejectedPhrase(title, track, 'video')) score -= 6;
  if (OFFICIAL_VIDEO.test(title)) score += 2;
  return { score: score - lengthPenalty(video.seconds, track, { shorter: 30, longer: 420 }) };
}

// plain youtube search, when nothing from youtube music checks out: only uploads on the artist's own channel titled as the music video
function rateWeb(video, track) {
  if (!hasSong(video.title, track)) return { rejected: 'title lacks the song name' };
  if (!isArtistChannel(video.channel, track, video.verifiedArtist)) return { rejected: "not the artist's channel" };
  const title = normalize(video.title);
  if (!OFFICIAL_VIDEO.test(title) && !MUSIC_VIDEO.test(title)) return { rejected: 'not titled as the music video' };
  const phrase = rejectedPhrase(title, track, 'video', { artistChannel: true });
  if (phrase) return { rejected: `"${phrase}"` };
  if (video.seconds && (video.seconds < 60 || video.seconds > 1200)) return { rejected: 'wrong length' };
  return { score: (OFFICIAL_VIDEO.test(title) ? 7 : 5) - lengthPenalty(video.seconds, track, { shorter: 30, longer: 420 }) };
}

// live performances: the artist's own channel or a trusted live music channel, never fan footage
function rateLive(video, track) {
  if (!hasSong(video.title, track)) return { rejected: 'title lacks the song name' };
  const artistChannel = isArtistChannel(video.channel, track, video.verifiedArtist);
  if (!artistChannel && !LIVE_CHANNELS.has(compact(video.channel))) return { rejected: 'not an official or trusted live channel' };
  if (!artistChannel && !nameKey(video.title).includes(nameKey(track.artists[0]))) return { rejected: 'not by the artist' };
  const title = normalize(video.title);
  if (!LIVE_MARKER.test(title)) return { rejected: 'not a live performance' };
  const phrase = rejectedPhrase(title, track, 'live', { artistChannel });
  if (phrase) return { rejected: `"${phrase}"` };
  if (video.seconds && (video.seconds < 60 || video.seconds > 900)) return { rejected: 'wrong length' };
  return { score: (artistChannel ? 6 : 5) - lengthPenalty(video.seconds, track, { shorter: 60, longer: 240 }) };
}

const queryFor = (track) => `${track.artists[0]} ${baseTitle(track.title)}`;

// null when youtube music can't be searched right now
async function rateMusicSearch(track) {
  try {
    return (await searchMusicVideos(queryFor(track))).map((video) => ({ ...video, source: 'music', ...rateMusic(video, track) }));
  } catch (err) {
    console.warn(`YouTube Music search failed (${err.message}).`);
    return null;
  }
}

const rateWebSearch = async (track) =>
  (await search(`${queryFor(track)} official music video`)).map((video) => ({ ...video, source: 'youtube', ...rateWeb(video, track) }));

const rateLiveSearch = async (track) =>
  (await search(`${queryFor(track)} live`)).map((video) => ({ ...video, source: 'youtube', ...rateLive(video, track) }));

// results that passed, best first, as small cache records
function shortlist(rated) {
  return rated
    .map((video, rank) => ({ ...video, rank }))
    .filter((video) => !video.rejected)
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, MAX_CANDIDATES)
    .map(({ id, title, channel, source }) => ({ id, title, channel, source }));
}

// the real video

// up to 100 small frames spread over the whole video, each reduced to 12x6 blocks of gray
function storyboardFrames(pixels, image, board) {
  const frames = [];
  const count = Math.min(board.thumbnail_count, board.columns * board.rows);
  const blockWidth = Math.floor(board.thumbnail_width / 12);
  const blockHeight = Math.floor(board.thumbnail_height / 6);
  for (let t = 0; t < count; t++) {
    const left = (t % board.columns) * board.thumbnail_width;
    const top = Math.floor(t / board.columns) * board.thumbnail_height;
    if (top + board.thumbnail_height > image.height) break;
    const blocks = new Float32Array(72);
    for (let by = 0; by < 6; by++) {
      for (let bx = 0; bx < 12; bx++) {
        let sum = 0;
        for (let y = top + by * blockHeight; y < top + (by + 1) * blockHeight; y++) {
          for (let x = left + bx * blockWidth; x < left + (bx + 1) * blockWidth; x++) {
            const i = (y * image.width + x) * image.channels;
            sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          }
        }
        blocks[by * 12 + bx] = sum / (blockWidth * blockHeight);
      }
    }
    frames.push(blocks);
  }
  return frames;
}

// album art uploads show one picture for the whole song, the storyboard gives that away since nearly every frame matches the video's typical frame, null when there's no storyboard to judge from
async function looksStill(storyboards) {
  const board = storyboards?.boards?.find((b) => b.storyboard_count === 1) ?? storyboards?.boards?.[0];
  if (!board) return null;
  const res = await fetch(board.template_url.replace('$M', '0'));
  if (!res.ok) return null;
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const frames = storyboardFrames(data, info, board);
  if (frames.length < 10) return null;
  const typical = new Float32Array(72);
  for (let b = 0; b < 72; b++) {
    const values = frames.map((frame) => frame[b]).sort((x, y) => x - y);
    typical[b] = values[Math.floor(values.length / 2)];
  }
  const differences = frames.map((frame) => frame.reduce((sum, value, b) => sum + Math.abs(value - typical[b]), 0) / 72).sort((x, y) => x - y);
  return differences[Math.floor(differences.length * 0.8)] < STILL_DIFFERENCE;
}

// the real video behind a search result, read from youtube's app api since the web player's data lacks end screens
async function inspect(videoId) {
  const yt = await client();
  let info;
  try {
    info = await yt.getBasicInfo(videoId, { client: 'ANDROID' });
  } catch (err) {
    // youtubei.js throws on youtube's own error answer, given for removed, terminated and invalid videos
    if (err.info?.status === 'ERROR') return { blocked: 'unavailable' };
    throw err;
  }
  const { status, reason } = info.playability_status ?? {};
  const title = info.basic_info.title ?? '';
  // age restricted videos never play embedded, youtube calls it "this video may be inappropriate for some users"
  if (/^AGE_|CONTENT_CHECK/.test(status) || (status === 'LOGIN_REQUIRED' && /inappropriate|\bage\b/i.test(reason))) return { blocked: 'age-restricted' };
  if (status === 'LOGIN_REQUIRED' && /private/i.test(reason)) return { blocked: 'private' };
  // anything else that comes without the video's details, like a bot check, is youtube challenging ktv, not a verdict
  if (status !== 'OK' && !title) throw new Error(`YouTube wouldn't describe ${videoId} (${status}: ${reason})`);
  const frame = [...(info.streaming_data?.formats ?? []), ...(info.streaming_data?.adaptive_formats ?? [])].find((f) => f.width && f.height);
  return {
    title,
    channel: info.basic_info.author ?? '',
    seconds: info.basic_info.duration || null,
    description: info.basic_info.short_description ?? '',
    still: await looksStill(info.storyboards).catch(() => null),
    aspectRatio: frame ? frame.width / frame.height : 16 / 9,
    // where and when uploaders' watch next thumbnails appear over the picture, so the tv can cover them
    endscreen: (info.endscreen?.elements ?? []).map((element) => ({
      style: element.style,
      left: element.left,
      top: element.top,
      width: element.width,
      aspectRatio: element.aspect_ratio,
      startMs: element.start_ms,
      endMs: element.end_ms,
    })),
  };
}

// why the real video can't air, or null when it's a clip
function checkClip(meta, track, kind) {
  if (meta.blocked) return meta.blocked;
  if (/ topic$/.test(normalize(meta.channel))) return 'album-art upload (Topic channel)';
  if (meta.still) return 'still picture, no clip';
  if (meta.seconds && (meta.seconds < 60 || meta.seconds > (kind === 'live' ? 900 : 1200))) return 'wrong length';
  const title = normalize(meta.title);
  const phrase = rejectedPhrase(title, track, kind, { artistChannel: isArtistChannel(meta.channel, track) });
  if (phrase) return `"${phrase}" in its title`;
  if (kind === 'live' && !LIVE_MARKER.test(title)) return 'not a live performance';
  return null;
}

// year a live performance was filmed, from its title or a description line about the performance, live music channels post right away so the upload year works too, archive footage elsewhere often says nothing so null rather than a guess
async function performanceYear(videoId, meta, track) {
  const thisYear = new Date().getFullYear();
  const plausible = (year) => year >= 1950 && year <= thisYear && !track.title.includes(String(year));
  const yearsIn = (text) => [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map(([year]) => Number(year)).filter(plausible);
  const titled = yearsIn(meta.title);
  if (titled.length) return titled.at(-1);
  const short = meta.title.match(/'(\d{2})\b/);
  if (short) {
    const year = Number(short[1]) + (Number(short[1]) > thisYear % 100 ? 1900 : 2000);
    if (plausible(year)) return year;
  }
  for (const line of meta.description.split('\n')) {
    if (!/\b(live|recorded|filmed|performed|performs?|broadcast|captured|session)\b/i.test(line)) continue;
    const [year] = yearsIn(line);
    if (year) return year;
  }
  if (!LIVE_CHANNELS.has(compact(meta.channel))) return null;
  // the app api used for everything else doesn't say when a video was uploaded, the web one does
  const info = await (await client()).getBasicInfo(videoId).catch(() => null);
  const uploaded = Number(info?.page?.[0]?.microformat?.publish_date?.slice(0, 4));
  return plausible(uploaded) ? uploaded : null;
}

// words that don't name a place on their own
const NOT_A_PLACE = new Set([
  'live', 'official', 'video', 'music', 'audio', 'performance', 'concert', 'show', 'session', 'sessions', 'stage', 'studio',
  'tour', 'version', 'acoustic', 'full', 'hd', '4k', 'remastered', 'lyric', 'lyrics', 'the', 'a', 'from', 'at', 'in', 'on',
  'exclusive', 'special', 'clip', 'uncut',
]);

// start of a phrase, up to where it stops naming a place
function tidyPlace(text) {
  return text
    .split(/\s*[()[\]{}|/:–—]\s*|\s+-\s+/u)[0]
    .replace(/,(?!\s*[A-Z]{2,3}\b).*$/u, '')
    .replace(/\s+(?:in\s+|on\s+)?(?:(?:19|20)\d{2}|'\d{2})\b.*$/iu, '')
    .replace(/\s+on\s+\d.*$/iu, '')
    .replace(/[\s.,;!?]+$/u, '')
    .trim();
}

// where a live performance was filmed, the venue, city or show its title or description names, null when nothing clear comes up
function performancePlace(meta, track) {
  const liveAt = /\blive\s+(?:at|in|on|from|@|à|au|aux|en|du|depuis)\s+(.+)/iu;
  const performedOn = /\bperform(?:s|ed|ing)?\b.*?\s(?:on|at)\s+(.+)/iu;
  const candidates = [
    meta.title.match(liveAt)?.[1],
    ...meta.title.split('|').slice(1),
    meta.title.match(/[([]([^)\]]*?\bsessions?)\b/iu)?.[1],
  ];
  for (const line of meta.description.split('\n').slice(0, 8)) {
    // links and calls to action aren't where anything was filmed
    if (/https?:|\b(?:stream|listen|subscribe|buy|shop|follow|tickets|pre-?order|available)\b/iu.test(line)) continue;
    candidates.push(line.match(liveAt)?.[1] ?? line.match(performedOn)?.[1]);
  }
  const artist = normalize(track.artists[0]);
  const song = normalize(track.title);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const place = tidyPlace(candidate);
    const key = normalize(place);
    const generic = place.toLowerCase().split(/\s+/).every((word) => NOT_A_PLACE.has(word.replace(/[^\p{L}\p{N}]/gu, '')));
    if (place.length < 2 || place.length > 48 || !key || generic || key === artist || song.includes(key)) continue;
    return place;
  }
  return null;
}

// resolving

// kind is video or live, candidates are checked in order until one can air, each verdict is remembered so a video is only looked at once
async function resolveKind(track, entry, kind) {
  let pool = entry[kind];
  const age = pool ? Date.now() - pool.searchedAt : Infinity;
  if (age > (pool?.found === false ? RETRY_NOT_FOUND_MS : RESEARCH_AFTER_MS)) {
    const rated = kind === 'live' ? await rateLiveSearch(track) : await rateMusicSearch(track);
    const refused = Object.fromEntries(Object.entries(pool?.rejected ?? {}).filter(([, why]) => why === REFUSED));
    pool = entry[kind] = {
      // when youtube music couldn't be searched, the next lookup searches again
      searchedAt: rated ? Date.now() : 0,
      candidates: shortlist(rated ?? []),
      rejected: refused,
      fallback: kind === 'live',
    };
    scheduleSave();
  }
  const live = kind === 'live';
  for (;;) {
    for (const candidate of pool.candidates) {
      if (pool.rejected[candidate.id]) continue;
      // live clips checked before performance years and places were kept get looked at once more
      if (!candidate.clip || (live && !('recordedPlace' in candidate.clip))) {
        const meta = await inspect(candidate.id);
        const problem = checkClip(meta, track, kind);
        scheduleSave();
        if (problem) {
          pool.rejected[candidate.id] = problem;
          continue;
        }
        candidate.clip = { title: meta.title, channel: meta.channel, aspectRatio: meta.aspectRatio, endscreen: meta.endscreen };
        if (live) {
          candidate.clip.recordedYear = await performanceYear(candidate.id, meta, track);
          candidate.clip.recordedPlace = performancePlace(meta, track);
        }
      }
      pool.found = true;
      const { title, channel, aspectRatio, endscreen, recordedYear = null, recordedPlace = null } = candidate.clip;
      const liveSource = live && LIVE_CHANNELS.has(compact(channel)) ? channel : null;
      return { id: candidate.id, title, channel, aspectRatio, endscreen, live, liveSource, recordedYear, recordedPlace };
    }
    if (pool.fallback) break;
    // nothing from youtube music checked out, look on the artist's own channel through plain youtube search
    const known = new Set(pool.candidates.map((candidate) => candidate.id));
    const more = shortlist(await rateWebSearch(track)).filter((candidate) => !known.has(candidate.id));
    pool.fallback = true;
    pool.candidates.push(...more);
    scheduleSave();
  }
  pool.found = false;
  scheduleSave();
  return null;
}

// a clip for the track, or null when it has none, with live a live performance when there is one
export async function resolveVideo(track, { live = false } = {}) {
  const entries = await getCache();
  const entry = (entries[track.key] ??= {});
  if (live) {
    try {
      const performance = await resolveKind(track, entry, 'live');
      if (performance) return performance;
    } catch (err) {
      console.warn(`Live lookup failed for ${track.artists[0]} - ${track.title}, using the music video: ${err.message}`);
    }
  }
  return resolveKind(track, entry, 'video');
}

export async function reportPlayback({ key, videoId, reason, streak = 1 }) {
  if (typeof key !== 'string' || typeof videoId !== 'string') return;
  console.warn(`Playback problem (${reason}) for ${key} on ${videoId}${streak > 1 ? ` (${streak} failures in a row)` : ''}`);
  if (!PERMANENT_ERRORS.has(reason) || !(Number(streak) <= MAX_TRUSTED_STREAK)) return;
  const entry = (await getCache())[key];
  for (const pool of [entry?.video, entry?.live]) {
    if (pool?.candidates.some((candidate) => candidate.id === videoId)) {
      pool.rejected[videoId] = REFUSED;
      scheduleSave();
    }
  }
}

// everything the matcher sees for one song, for npm run resolve: every search result and for each shortlisted one the real video and its verdict, AIRS marks the one that would air, backup the ones next in line, no cache involved
export async function explain(track, { live = false } = {}) {
  const kind = live ? 'live' : 'video';
  const searches = live ? [await rateLiveSearch(track)] : [(await rateMusicSearch(track)) ?? [], await rateWebSearch(track)];
  const verdicts = new Map();
  let airs = false;
  for (const rated of searches) {
    for (const { id } of shortlist(rated)) {
      if (verdicts.has(id)) continue;
      const meta = await inspect(id);
      const problem = checkClip(meta, track, kind);
      const real = meta.blocked ? null : `${meta.title} [${meta.channel}]${meta.still ? ' (still picture)' : ''}`;
      verdicts.set(id, { verdict: problem ?? (airs ? 'backup' : 'AIRS'), real });
      airs ||= !problem;
    }
  }
  return searches.flat().map((video) => ({ ...video, ...verdicts.get(video.id) }));
}
