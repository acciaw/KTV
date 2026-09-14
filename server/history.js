// listen history, one json line per clip in data/history.jsonl, the tv reports each clip as it ends
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const FILE = 'history.jsonl';
const REASONS = new Set(['end', 'skip', 'error', 'close']);
const MAX_SECONDS = 4 * 3600; // one clip, whatever was reported
const CLOCK_SKEW_MS = 60_000; // a tv's clock a little ahead of the server's
const DAYS = 30;
const TOP = 10;

let writing = Promise.resolve();
const historyFile = () => path.join(config.dataDir, FILE);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// one play as the tv reports it, cleaned up, null when there's nothing worth keeping
function toPlay(body, now = Date.now()) {
  const seconds = Math.round(Number(body?.seconds));
  const title = text(body?.title, 300);
  const artists = (Array.isArray(body?.artists) ? body.artists : []).map((name) => text(name, 200)).filter(Boolean).slice(0, 10);
  if (!Number.isFinite(seconds) || seconds < 1 || !title || !artists.length) return null;
  const started = Date.parse(body.startedAt);
  const at = Number.isFinite(started) && started <= now + CLOCK_SKEW_MS ? started : now - seconds * 1000;
  const image = text(body.image, 500);
  return {
    at: new Date(at).toISOString(),
    seconds: Math.min(seconds, MAX_SECONDS),
    artists,
    title,
    album: text(body.album, 300) || null,
    year: text(String(body.year ?? ''), 10) || null,
    image: image.startsWith('https://') ? image : null,
    videoId: text(body.videoId, 20) || null,
    live: body.live === true,
    source: text(body.source, 40) || null,
    reason: REASONS.has(body.reason) ? body.reason : 'end',
    session: text(body.session, 64) || null,
  };
}

export async function recordPlay(body) {
  const play = toPlay(body);
  if (!play) return null;
  writing = writing.catch(() => {}).then(async () => {
    await mkdir(config.dataDir, { recursive: true });
    await appendFile(historyFile(), `${JSON.stringify(play)}\n`);
  });
  await writing;
  return play;
}

async function readPlays() {
  let raw;
  try {
    raw = await readFile(historyFile(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const plays = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      plays.push(JSON.parse(line));
    } catch {
      // a line cut short, by a crash mid write for instance
    }
  }
  // several tvs can report out of order
  return plays.sort((a, b) => a.at.localeCompare(b.at));
}

function timeZoneOf(requested) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: requested || undefined }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// local day and hour of a moment, in the given time zone
function calendar(timeZone) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return { dayOf: (time) => day.format(time), hourOf: (time) => Number(hour.format(time)) % 24 };
}

// last count local days up to today, oldest first, steps back a few hours at a time for clock changes
function lastDays(dayOf, now, count) {
  const days = [];
  for (let time = now; days.length < count; time -= 6 * 3600_000) {
    const day = dayOf(time);
    if (days.at(-1) !== day) days.push(day);
  }
  return days.reverse();
}

const blank = () => ({ seconds: 0, plays: 0 });
const count = (total, play) => {
  total.seconds += play.seconds;
  total.plays += 1;
};

// songs and artists by time listened then by plays, every credited artist gets the song's time
function ranking() {
  const songs = new Map();
  const artists = new Map();
  const order = (a, b) => b.seconds - a.seconds || b.plays - a.plays;
  return {
    add(play) {
      const songKey = `${play.artists[0].toLowerCase()}|${play.title.toLowerCase()}`;
      const song = songs.get(songKey) ?? { artists: play.artists, title: play.title, image: null, ...blank() };
      count(song, play);
      song.image ??= play.image;
      songs.set(songKey, song);
      for (const name of play.artists) {
        const artist = artists.get(name.toLowerCase()) ?? { name, image: null, ...blank() };
        count(artist, play);
        artist.image ??= play.image;
        artists.set(name.toLowerCase(), artist);
      }
    },
    top: () => ({ songs: [...songs.values()].sort(order).slice(0, TOP), artists: [...artists.values()].sort(order).slice(0, TOP) }),
    size: () => ({ songs: songs.size, artists: artists.size }),
  };
}

// everything the stats page shows, for a viewer in timeZone, an iana name like "Europe/Paris"
export async function historyStats({ timeZone, now = Date.now() } = {}) {
  const plays = await readPlays();
  const zone = timeZoneOf(timeZone);
  const { dayOf, hourOf } = calendar(zone);
  const days = lastDays(dayOf, now, DAYS);
  const today = days.at(-1);
  const week = new Set(days.slice(-7));
  const month = new Set(days);
  const totals = { today: blank(), week: blank(), month: blank(), all: blank() };
  const perDay = new Map(days.map((day) => [day, blank()]));
  const hours = Array.from({ length: 24 }, () => 0);
  const tops = { week: ranking(), month: ranking(), all: ranking() };
  const sessions = new Set();
  const extra = { liveSeconds: 0, discoveryPlays: 0, skips: 0 };
  for (const play of plays) {
    const time = Date.parse(play.at);
    const day = dayOf(time);
    count(totals.all, play);
    tops.all.add(play);
    if (month.has(day)) {
      count(totals.month, play);
      count(perDay.get(day), play);
      tops.month.add(play);
    }
    if (week.has(day)) {
      count(totals.week, play);
      tops.week.add(play);
    }
    if (day === today) count(totals.today, play);
    hours[hourOf(time)] += play.seconds;
    if (play.session) sessions.add(play.session);
    if (play.live) extra.liveSeconds += play.seconds;
    if (play.source === 'discovery') extra.discoveryPlays += 1;
    if (play.reason === 'skip') extra.skips += 1;
  }
  return {
    timeZone: zone,
    since: plays[0]?.at ?? null,
    totals,
    ...tops.all.size(),
    sessions: sessions.size,
    ...extra,
    days: days.map((day) => ({ day, ...perDay.get(day) })),
    hours,
    top: { week: tops.week.top(), month: tops.month.top(), all: tops.all.top() },
  };
}

// latest plays newest first, limit at a time, before is the at of the oldest play already shown
export async function historyPage({ before, limit } = {}) {
  const plays = await readPlays();
  const older = typeof before === 'string' && before ? plays.filter((play) => play.at < before) : plays;
  const size = Math.min(Math.max(Math.round(Number(limit)) || 50, 1), 200);
  return { plays: older.slice(-size).reverse(), more: older.length > size };
}

export async function clearHistory() {
  await writing.catch(() => {});
  await rm(historyFile(), { force: true });
}
