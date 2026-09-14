// the stats page (/admin/stats): hours listened, when, top artists and songs, and the listen history (server/history.js)

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PAGE_SIZE = 50;

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// numbers and dates

const pad = (n) => String(n).padStart(2, '0');
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// "45 s", "12 min", "2 h 05"
function duration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`;
}

// scoreboard figure, hours once there's an hour to show, minutes before that
function figure(seconds) {
  if (seconds >= 3600) {
    const tenths = Math.round(seconds / 360) / 10;
    return { value: decimal.format(tenths), unit: tenths === 1 ? 'hour' : 'hours' };
  }
  const minutes = Math.round(seconds / 60);
  return { value: String(minutes), unit: minutes === 1 ? 'minute' : 'minutes' };
}

// days come from the server as "2026-09-14" in this browser's time zone, noon utc names the same day anywhere
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
const localDay = (iso) => dayKey.format(new Date(iso));
const noonOf = (day) => new Date(`${day}T12:00:00Z`);
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const mediumDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function dayHeading(day) {
  if (day === dayKey.format(new Date())) return 'Today';
  if (day === dayKey.format(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return longDay.format(noonOf(day));
}

// pieces

function card(accent, channel, title, ...children) {
  const box = element('section', 'card');
  box.dataset.accent = accent;
  const head = element('header', 'module-head');
  head.append(element('span', 'ch', channel), element('h2', '', title));
  box.append(head, ...children);
  return box;
}

function cover(image) {
  if (!image) return element('span', 'cover ph');
  const art = element('img', 'cover');
  art.src = image;
  art.alt = '';
  art.loading = 'lazy';
  return art;
}

// bar chart as a list, each bar's height is its share of the tallest, label read out and shown on hover
function bars(className, entries) {
  const chart = element('ol', `bars ${className}`);
  const peak = Math.max(1, ...entries.map((entry) => entry.seconds));
  for (const { seconds, label, tick } of entries) {
    const bar = element('li', seconds ? 'bar' : 'bar empty');
    bar.style.setProperty('--level', (seconds / peak).toFixed(3));
    bar.title = label;
    bar.append(element('span', 'visually-hidden', label));
    if (tick) {
      const mark = element('span', 'bar-tick', tick);
      mark.setAttribute('aria-hidden', 'true');
      bar.append(mark);
    }
    chart.append(bar);
  }
  return chart;
}

// sections

function scoreboard({ totals, since }) {
  const board = element('section', 'scoreboard');
  board.setAttribute('aria-label', 'Hours listened');
  const tile = (label, { seconds, plays }, main = false) => {
    const { value, unit } = figure(seconds);
    const box = element('div', main ? 'score score-main' : 'score');
    const number = element('p', 'score-number');
    number.append(element('span', 'score-value', value), element('span', 'score-unit', unit));
    const detail = main && since ? `${plural(plays, 'clip')} since ${fullDate.format(new Date(since))}` : plural(plays, 'clip');
    box.append(element('p', 'score-label', label), number, element('p', 'score-detail', detail));
    return box;
  };
  board.append(tile('Hours listened', totals.all, true), tile('Today', totals.today), tile('Last 7 days', totals.week), tile('Last 30 days', totals.month));
  return board;
}

// all time counts as a ticker strip under the scoreboard
function ticker(stats) {
  const strip = element('dl', 'ticker');
  const liveShare = stats.totals.all.seconds ? Math.round((stats.liveSeconds / stats.totals.all.seconds) * 100) : 0;
  for (const [term, value] of [
    ['Songs', stats.songs],
    ['Artists', stats.artists],
    ['TV sessions', stats.sessions],
    ['Live', `${liveShare}%`],
    ['Discovery clips', stats.discoveryPlays],
    ['Skipped', stats.skips],
  ]) {
    const fact = element('div', 'fact');
    fact.append(element('dt', '', term), element('dd', '', String(value)));
    strip.append(fact);
  }
  return strip;
}

function daysCard({ days }) {
  const last = days.length - 1;
  const chart = bars('bars-days', days.map(({ day, seconds, plays }, i) => ({
    seconds,
    label: `${mediumDay.format(noonOf(day))}: ${seconds ? `${duration(seconds)}, ${plural(plays, 'clip')}` : 'nothing'}`,
    tick: (last - i) % 7 === 0 ? (i === last ? 'Today' : shortDay.format(noonOf(day))) : '',
  })));
  const busiest = days.reduce((best, entry) => (entry.seconds > best.seconds ? entry : best));
  const note = busiest.seconds ? `Busiest day: ${longDay.format(noonOf(busiest.day))}, ${duration(busiest.seconds)}.` : 'Nothing aired in the last 30 days.';
  return card('cyan', 'CH 01', 'Last 30 days', chart, element('p', 'note chart-note', note));
}

function hoursCard({ hours, timeZone }) {
  const chart = bars('bars-hours', hours.map((seconds, hour) => ({
    seconds,
    label: `${pad(hour)}:00 to ${pad((hour + 1) % 24)}:00: ${seconds ? duration(seconds) : 'nothing'}`,
    tick: hour % 6 === 0 ? `${pad(hour)}:00` : '',
  })));
  const peak = Math.max(...hours);
  const busiest = hours.indexOf(peak);
  const note = `All time, hour by hour in ${timeZone.replaceAll('_', ' ')}.${peak ? ` The busiest hour is ${pad(busiest)}:00 to ${pad((busiest + 1) % 24)}:00.` : ''}`;
  return card('purple', 'CH 02', 'When you watch', chart, element('p', 'note chart-note', note));
}

function topList(title, entries) {
  const box = element('div', 'top-list');
  box.append(element('h3', 'top-title', title));
  if (!entries.length) {
    box.append(element('p', 'note', 'Nothing in this period.'));
    return box;
  }
  const list = element('ol', 'countdown');
  const best = entries[0].seconds || 1;
  entries.forEach((entry, i) => {
    const row = element('li', 'countdown-row');
    row.style.setProperty('--share', (entry.seconds / best).toFixed(3));
    const text = element('div', 'countdown-text');
    text.append(element('span', 'countdown-name', entry.name));
    if (entry.detail) text.append(element('span', 'countdown-detail', entry.detail));
    row.append(element('span', 'countdown-rank', pad(i + 1)), cover(entry.image), text, element('span', 'countdown-time', `${duration(entry.seconds)} · ${entry.plays}×`));
    list.append(row);
  });
  box.append(list);
  return box;
}

function topCard(stats) {
  const picker = element('div', 'service-picker period-picker');
  picker.setAttribute('role', 'tablist');
  picker.setAttribute('aria-label', 'Period');
  const lists = element('div', 'top-lists');
  const show = (period) => {
    for (const button of picker.children) button.setAttribute('aria-selected', String(button.dataset.period === period));
    const { artists, songs } = stats.top[period];
    lists.replaceChildren(
      topList('Artists', artists.map((artist) => ({ ...artist, detail: '' }))),
      topList('Songs', songs.map((song) => ({ ...song, name: song.title, detail: song.artists.join(', ') }))),
    );
  };
  for (const [period, label] of [['week', '7 days'], ['month', '30 days'], ['all', 'All time']]) {
    const button = element('button', 'pick', label);
    button.type = 'button';
    button.dataset.period = period;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => show(period));
    picker.append(button);
  }
  show(stats.totals.week.plays ? 'week' : stats.totals.month.plays ? 'month' : 'all');
  return card('pink', 'CH 03', 'Top 10', picker, lists);
}

function historyRow(play) {
  const row = element('li', 'log-row');
  const time = element('time', 'log-time', clock.format(new Date(play.at)));
  time.dateTime = play.at;
  const text = element('div', 'log-text');
  const title = element(play.videoId ? 'a' : 'span', 'log-title', play.title);
  if (play.videoId) {
    title.href = `https://www.youtube.com/watch?v=${encodeURIComponent(play.videoId)}`;
    title.target = '_blank';
    title.rel = 'noopener';
  }
  text.append(title, element('span', 'log-artist', play.artists.join(', ')));
  const album = [play.album, play.year].filter(Boolean).join(' · ');
  if (album) text.append(element('span', 'log-album', album));
  const tags = element('span', 'log-tags');
  if (play.live) tags.append(element('span', 'tag tag-live', 'Live'));
  if (play.source === 'discovery') tags.append(element('span', 'tag tag-discovery', 'Discovery'));
  if (play.reason === 'skip') tags.append(element('span', 'tag tag-skip', 'Skipped'));
  row.append(time, cover(play.image), text, tags, element('span', 'log-length', duration(play.seconds)));
  return row;
}

function historyCard(root, first) {
  const log = element('div', 'log');
  const more = element('button', 'ghost', 'Load more');
  more.type = 'button';
  let list = null;
  let lastDay = null;
  let oldest = null;
  const add = ({ plays, more: hasMore }) => {
    for (const play of plays) {
      const day = localDay(play.at);
      if (day !== lastDay) {
        lastDay = day;
        list = element('ol', 'log-list');
        log.append(element('h3', 'tape log-day', dayHeading(day)), list);
      }
      list.append(historyRow(play));
    }
    oldest = plays.at(-1)?.at ?? oldest;
    more.hidden = !hasMore;
  };
  more.addEventListener('click', async () => {
    more.disabled = true;
    try {
      add(await api(`/api/history?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest)}`));
    } finally {
      more.disabled = false;
    }
  });
  const clear = element('button', 'danger', 'Clear history');
  clear.type = 'button';
  clear.addEventListener('click', async () => {
    if (!confirm('Clear the whole listen history? The hours listened start again from zero.')) return;
    await api('/api/history', { method: 'DELETE' });
    await startStats(root);
  });
  add(first);
  const actions = element('div', 'actions');
  actions.append(more, clear);
  return card('yellow', 'CH 04', 'Listen history', element('p', 'note', 'Every clip the TV played, newest first, with how long it played.'), log, actions);
}

function emptyState() {
  const box = card('lime', 'Standby', 'Nothing has aired yet', element('p', '', 'Tune in on the TV, and every clip that plays shows up here: hours listened, when you watch, your most played artists and songs, and the full listen history.'));
  const actions = element('div', 'actions');
  const link = element('a', 'btn', 'Open the TV ▶');
  link.href = '/tv';
  actions.append(link);
  box.append(actions);
  return box;
}

export async function startStats(root) {
  root.hidden = false;
  root.replaceChildren(element('p', 'loading', 'Loading'));
  try {
    const [stats, history] = await Promise.all([api(`/api/stats?tz=${encodeURIComponent(TIME_ZONE)}`), api(`/api/history?limit=${PAGE_SIZE}`)]);
    if (!stats.totals.all.plays) {
      root.replaceChildren(emptyState());
      return;
    }
    root.replaceChildren(scoreboard(stats), ticker(stats), daysCard(stats), hoursCard(stats), topCard(stats), historyCard(root, history));
  } catch (err) {
    root.replaceChildren(card('pink', 'Error', "The stats didn't load", element('p', 'error', err.message)));
  }
}
