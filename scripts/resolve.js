// shows what ktv would air for a song and why the other candidates were skipped, doesn't touch the cache
//   npm run resolve -- "a-ha" "Take On Me"
//   npm run resolve -- "a-ha" "Take On Me" 225 --live
import { explain } from '../server/youtube.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const [artist, title, seconds] = args.filter((arg) => arg !== '--live');
if (!artist || !title) {
  console.error('Usage: npm run resolve -- "<artist>" "<title>" [seconds] [--live]');
  process.exit(1);
}

const track = { key: 'cli', title, artists: [artist], durationMs: seconds ? Number(seconds) * 1000 : null };
const results = await explain(track, { live });
const RANK = { AIRS: 0, backup: 1 };
const order = (video) => RANK[video.verdict] ?? (video.verdict ? 2 : video.rejected ? 3 : 4);
for (const video of results.sort((a, b) => order(a) - order(b))) {
  const status = video.verdict in RANK ? video.verdict : `skip: ${video.verdict ?? video.rejected ?? 'not checked (lower on the list)'}`;
  console.log(`${status.padEnd(40)} ${video.source.padEnd(7)} https://youtu.be/${video.id}  ${video.title}  [${video.channel}]`);
  if (video.real) console.log(`${''.padEnd(40)} real video: ${video.real}`);
}
if (!results.some((video) => video.verdict === 'AIRS')) {
  console.log(live ? 'No live performance found: this song plays its music video.' : 'No official music video found: this song is skipped.');
}
