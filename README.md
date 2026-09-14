# KTV — your own music television

Open `/tv` on any screen (projector, TV browser, laptop) and KTV runs non-stop music videos picked from your music on Spotify, YouTube, Apple Music, Deezer or Last.fm. It adds a restyling station logo in the corner, title cards, and MTV-style transitions between clips. Close the tab and it stops.

The channel is named after you: the logo shows your initial ("K" for Acciaw, the default), and the TV calls itself "Acciaw Television".

- **Your music services** are only used to read *what* to play (liked songs, playlists, top tracks). Nothing plays on your accounts, so you can keep listening at the same time. The library is re-read at most every `LIBRARY_TTL_HOURS`.
- **YouTube** provides the video, through the official IFrame player running in the browser. Each song gets its official music video, and every pick is checked against the real video before it airs (see *A clip isn't the actual music video*). YouTube's controls, title bar, logo, captions and end screens are kept off the screen.
- **The server stays dormant.** It has no timers or background jobs, and only works when a TV page asks for the next clip.

```
 TV browser (/tv)                        KTV server (Node)                    outside
 ───────────────                         ─────────────────                    ───────
 YouTube IFrame player  ── GET /api/next ─▶ library.js  pick a random track ─▶ Spotify and other music services (rarely)
 transitions / logo /   ◀─ track + videoId ─ youtube.js  track → video id    ─▶ YouTube Music search (once per song, cached)
 lower thirds           ── POST /api/report ▶ (skip videos that won't embed)  ─▶ Last.fm similar tracks (optional)
                                            releases.js first album + year  ─▶ MusicBrainz (once per song, cached)
```

## Quick start

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:8787/admin. The first visit walks you through a three-step onboarding:
1. **Your name.** Its first letter goes in the logo, and it becomes the channel name.
2. **Your music.** Pick a service. For Spotify, create a free Spotify app (the page shows exactly what to do, including the redirect URI to register), paste its client ID and secret, and log in with Spotify. The account that creates the app needs Premium. YouTube, Apple Music, Deezer and Last.fm are covered under *Music services*.
3. **Lineup.** Pick which of your songs to use: liked songs, top tracks, playlists, depending on the service. Finishing builds the lineup once.

Then open http://localhost:8787/tv and press any key. Until the onboarding is done, `/tv` sends you to `/admin`.

`npm run dev` restarts when code changes, but not when `.env` changes. Stop it with Ctrl+C and start it again after editing `.env`.

Spotify limits for development-mode apps (February 2026 rules):
- The app owner needs **Premium**, and the app can have at most 5 users.
- Apps can only read the tracks of playlists **you own or collaborate on**. To air someone else's playlist, copy its songs into a playlist of your own.
- The recommendations and related-artists endpoints are closed to new apps. That's why discovery uses Last.fm.

## Control room (`/admin`)

After the onboarding, `/admin` is where everything is changed:
- **Channel:** your name, and with it the logo letter.
- **Spotify:** edit or remove the app, or reconnect your account.
- **More music services:** connect, edit or remove YouTube, Apple Music, Deezer and Last.fm.
- **Optional services:** a Last.fm API key turns on discovery (songs similar to yours that you haven't saved), and a YouTube Data API key is a backup for video lookups if YouTube blocks KTV's normal search. Keys are checked before they're saved.
- **Lineup:** sources and playlists for each connected service, live performances (experimental), discovery share, eras, artists, and a button to rebuild now.
- **Stats** (`/admin/stats`): hours listened today, over the last 7 and 30 days and in all, a chart of the last 30 days and one of the hours you watch at, your top 10 artists and songs, and the listen history: every clip the TV played, when, and for how long. The history can be cleared there.

Saved secrets (app secrets, the Apple Music key and the API keys) are never sent back to the browser. Their fields only say a key is saved; typing replaces it.

Everything lives in `data/settings.json`, with the logins in `data/spotify-tokens.json`, `data/youtube-tokens.json` and `data/applemusic-token.json`, on the server, in plain text. The listen history is in `data/history.jsonl`, one line per clip. `data/` is gitignored.

### Backing up settings

```sh
npm run settings -- export [file]   # everything above, secrets and service logins included (default: ktv-settings.backup.json, gitignored)
npm run settings -- import [file]   # restore a backup, then restart KTV
npm run settings -- reset           # delete the saved settings so the onboarding starts again, then restart KTV
```

## Music services

Connect any of them in the onboarding or later in the control room. Their songs join one lineup, and a song saved on two services is only in it once. Whichever service a song comes from, it gets its official music video.

- **Spotify:** liked songs, top tracks and your playlists, through a free Spotify app of your own (see *Quick start*).
- **YouTube:** your liked videos (the ones YouTube files under Music) and your playlists, YouTube Music playlists included. It uses a free Google Cloud app of your own with the YouTube Data API; the form in `/admin` walks through creating it and shows the redirect URI to register. Publish the app in Google Auth Platform: while an app is in testing, Google ends its login after 7 days.
- **Apple Music:** the songs in your library and your playlists. It needs a paid Apple Developer Program membership for a MusicKit key (a Media ID with MusicKit, then a key with Media Services). After saving the key, you sign in with Apple Music in a pop-up. Apple's sign-in lasts about six months, then use **Sign in again**.
- **Deezer:** favourite tracks and playlists from your profile link. There's no app to create, but the profile has to be public.
- **Last.fm:** loved tracks, and top tracks from the last six months, from your username and a Last.fm API key. Last.fm counts what you play in other apps that report to it, so it also covers services KTV can't read directly.

## Deployment settings (`.env`)

| Variable | Effect |
| --- | --- |
| `PORT` | Port to listen on (default 8787). |
| `BASE_URL` | Public URL of the server. Spotify redirects to `$BASE_URL/auth/callback`. Spotify only accepts plain http for `127.0.0.1`, not for `localhost`, so keep it on `127.0.0.1` locally. |
| `ACCESS_KEY` | Keeps strangers out. Open `/tv?key=...` once per device and a cookie remembers it. |
| `END_CUT_SECONDS` | Seconds cut from the end of every video before the transition to the next one (default 10). A clip also ends just before its video's end screen when KTV knows when that starts. |
| `MAX_CLIP_SECONDS` | Cuts each video after N seconds, for a faster pace. |
| `LIBRARY_TTL_HOURS` | How long the lineup snapshot is reused (default 12). |
| `DATA_DIR` | Where settings, tokens and caches are kept (default `./data`). Handy for running a second channel or a test copy next to your own. |

## What plays

- **Official music videos.** Never lyric videos, visualizers, still album covers, "- Topic" uploads, live versions, covers or reactions. How that's checked is under *A clip isn't the actual music video*. A song with no official video is skipped, unless live performances are on and its turn lands on a live version.
- **No repeats within a session.** Every time the TV page is opened, a new session starts. No song plays twice in it until the whole lineup has aired, then the lineup starts over. Reloading the page, or opening it again later, starts a fresh session, so songs can come back.
- **Live performances (experimental, off by default).** Turn them on in the control room's lineup. Each song then has an even chance of airing live instead of as its music video, when KTV finds a live version on the artist's own channel or on a trusted live-music channel: BBC Music, KEXP, NPR Music (Tiny Desk), COLORS, Audiotree, the late-night shows, big festivals and a few more, listed in `server/youtube.js`. Fan-filmed videos, full concerts, audio-only uploads and covers are never used. When a song has no such live version, its music video plays.
- **Eras.** The slider under *Lineup* runs from the decade of your earliest song to the decade of your latest. Pull its ends in to keep only some decades. A song counts for the year it first came out (from MusicBrainz), or its album's year until that's known; songs with no year at all are looked up when they come up, and skipped if they're from another era.
- **Artists.** *Choose artists* under *Lineup* lists everyone in the lineup. Unchecked artists never play, including the songs they're featured on.

## On screen

- **Corner logo (top right).** Takes a new pattern and colors every 5 seconds, with a flip, spin, pop or glitch (`public/bug.js`).
- **Title card (bottom left).** Artist, title, album and year on a slanted, layered color panel that slides in from the left edge with a random move (slide, glitch, layered, stretch or whoosh) and slides back out. It shows a few seconds into each clip, about every minute or so after that, and near the end. Text is black or white, whichever has the better contrast with the panel (always at least 4.5:1). Names are shown without remaster and live tags ("Heroes - 2017 Remaster" shows as "Heroes", and a live album's name is left out), since the clip is usually the official video rather than that recording. A clip that really is a live performance gets a "Live" tag, naming the channel when it's a live-music channel ("Live · KEXP"). The album is the one the song first came out on and the year is when it was first released, looked up once per song on MusicBrainz, because music services only know the release a song was saved from (often a compilation, a later soundtrack or a remaster). When MusicBrainz doesn't know a song, the service's album shows if it's an actual album. For a live performance, the card shows when and where it was filmed instead, as far as the video's title or description says ("1997 · Later... with Jools Holland").
- **Transitions.** Nine styles: static, blocks, vhs, bumper, sunburst, tiles, blinds, splat and memphis. The bumper, a full station ident, runs every 5th clip.
- **Jingles.** Every transition plays a short station jingle in a random style (synthwave, chiptune, funk brass, radio ID, lo-fi or rock), never the same twice in a row, with a voice calling out the station ("K T V"). The tunes are generated live in the browser (`public/jingles.js`). The voice is recorded for every letter from A to Z in four deliveries (a deep announcer, an upbeat host, a British host and a soft late-night voice), and each style puts it through its own effects: doubled and drenched in reverb for synthwave, sped up, bit-crushed and stuttering for chiptune, a wah for funk, a gritty on-air radio band for the radio ID, tape wobble for lo-fi, distortion for rock. Initials without a recording (digits, other alphabets) use the device's own speech engine instead. Muting the TV mutes jingles too.
- **Tune-in and boot.** Pressing a key switches the tune-in screen off like an old CRT set, with the sound of one: the picture flares, collapses into a bright line, then into a dot that fades from the glass. The set powers back on onto the boot screen, which only runs at the start of a session. The tube warms up through static and color bars under a channel display and a signal meter, and the logo slams in on the hit of the boot jingle, a longer one of its own (about 8 seconds). The logo restyles on its beat, the station's letters come up as the voice calls them out in a break, and "On air" lights up on the final chord. The first clip is looked up while the tune-in screen waits and loads under the boot screen, which opens onto it once it's playing, its sound coming up as the last chord rings out. YouTube's player stays hidden until then.
- **Clip endings.** Every clip stops `END_CUT_SECONDS` before the video really ends, or just before its end screen when that comes earlier, and fades into the next transition. If a video does reach its end, the picture is hidden immediately.
- **End screens.** Many uploaders place clickable "watch next" thumbnails over their last 10 to 20 seconds. KTV knows when and where each one appears for most videos, so the clip ends a second before the first thumbnail and the transition is already up when it would show. If thumbnails show anyway, KTV covers each one with its own card: what's up next, or the channel logo.
- **Transition length.** On a clip change, the transition keeps its logo on screen for about 4 seconds after the next video starts, while the song fades in underneath. YouTube's embedded player (redesigned in March 2026) draws a play/pause button in the middle of the picture for that long whenever playback starts, and there is no setting to turn it off. A manual pause is left alone, so YouTube's button shows as usual.
- **Hiccups stay off screen.** If the server can't be reached for a moment, the transition simply lasts a bit longer while KTV retries. A video that fails to load for a passing reason gets a second try after the next song. The technical difficulties card only appears after a minute without the server, or when YouTube refuses six videos in a row.

## Controls on the TV page

| Key | Action |
| --- | --- |
| any key but `Esc` / click | tune in (browsers need one interaction before playing sound) |
| `→` or `N` | skip (a skip pressed during a transition runs right after it) |
| `1` – `9` | skip using a specific transition, in the order listed above |
| `I` / `Enter` | show the title card |
| click | back to fullscreen after `Esc` left it, otherwise show the title card |
| `M` | mute |
| `Space` | pause |
| `F` | fullscreen on or off |
| `Esc` | leave fullscreen |

## Troubleshooting

### Videos won't play (error 150 in the server log)

YouTube refuses most label music videos when the page embedding them was opened by **IP address**, such as `http://127.0.0.1:8787` or `http://192.168.1.20:8787`. The same videos play fine when the page is opened by a hostname.

- **On the machine running KTV**, use `http://localhost:8787/tv`. Opening `127.0.0.1` redirects there automatically.
- **On a TV or projector on your network**, open KTV by a name instead of its IP. Use your domain (see *Deploying*), or a wildcard DNS name that points to the IP, such as `http://192-168-1-20.sslip.io:8787/tv`. When the TV page is opened by IP, it shows this hint.

If several different videos fail in a row, KTV assumes the TV is the problem and doesn't blacklist those videos.

### A clip isn't the actual music video

KTV finds each song's video in three steps:
1. **YouTube Music video search.** YouTube Music labels results as official uploads, user uploads or still-image album tracks. Only official uploads credited to the song's artist are kept, best match first.
2. **A check of the real video.** YouTube Music also labels lyric videos, visualizers and audio uploads as official, and its titles aren't the videos' real ones. So before a candidate airs, KTV reads the actual video from YouTube and skips it when:
   - its real title says it's a lyric video, visualizer, audio, live version, cover, remix, reaction, teaser and so on (unless the song itself is called that),
   - it's on a "- Topic" channel (YouTube's automatic album-art uploads),
   - it's a still picture: its storyboard, the preview frames of the seek bar, shows nearly the same image all the way through,
   - it can't play embedded at all (removed, private or age-restricted).

   Each video is checked once, and the next candidate is tried.
3. **Plain YouTube search, as a fallback.** When nothing from YouTube Music passes, KTV looks for an upload on the artist's own channel that is titled as the official or music video, and checks it the same way.

A Spotify track that is itself a live or remastered recording gets the song's official music video.

Run `npm run resolve -- "artist" "title" [seconds] [--live]` to see every search result, the real video behind each candidate, and which one would air or why it was skipped. The rules are in `server/youtube.js`. After changing them, bump `CACHE_VERSION` so every song is searched again.

### Ads

With YouTube Premium, the embedded player is ad-free if the TV's browser is signed in to your Premium account and lets YouTube use its cookies inside other sites.
1. Sign in at youtube.com in that browser.
2. Chrome allows those cookies by default. Brave and Safari block them, so Premium isn't recognized there. Brave's Shields usually block the ads anyway. In Safari, you'd have to turn off "Prevent cross-site tracking".

Whatever KTV plays then shows up in that account's YouTube watch history.

### Captions

KTV switches captions off every time a video starts. Subtitles that are burned into the video picture itself can't be removed.

## Where things live

```
server/
  index.js      routes, onboarding and control room API, Spotify and Google logins, access key, 127.0.0.1 → localhost redirect
  settings.js   channel name, music services, API keys and lineup, in data/settings.json
  library.js    lineup snapshot from every service, era and artist filters, picks without repeats per TV session, live or music video, discovery, second tries
  spotify.js    token refresh + playlist/liked/top reads
  services.js   the other music services, side by side
  youtube-account.js  your YouTube likes and playlists (Google login)
  applemusic.js your Apple Music library (MusicKit key and sign-in)
  deezer.js     your public Deezer profile
  youtube.js    music video and live lookups, checks against the real video, end-screen positions, cache in data/youtube-cache.json
  releases.js   the album a song first came out on and its first release year (MusicBrainz), cache in data/release-cache.json
  text.js       title and name matching shared by the lookups
  history.js    the listen history in data/history.jsonl, and the stats worked out from it
  lastfm.js     similar tracks, and loved and top tracks for the Last.fm service
  demo.js       demo lineup
public/
  tv.html/js/css   the channel: player, tick loop, end-screen covers, controls
  transitions.js   the nine transitions (add your own here)
  boot.js          the boot screen that opens a session, after the tune-in screen switches off
  clip.js          where each clip stops: before the video's end, and before its end screen
  lowerthird.js    the title card panel, its moves and the text contrast check
  names.js         song and album names as shown, without remaster and live tags
  jingles.js       the jingle styles and the station voice's effects
  sound.js         the shared Web Audio output and mute
  bug.js           the corner logo and its restyling moves
  logo.js          the logo (your initial + "TV"), its animated fill patterns and the palette
  logo.css         fonts and base style for any page that shows the logo
  fonts/           Permanent Marker and Rubik Mono One, with their licenses
  voice/           the recorded station IDs (A to Z, four deliveries each), with their credits
  admin.html/js/css  onboarding and control room
  stats.js         the stats page: hours listened, charts, top 10 and listen history
scripts/
  resolve.js    shows which video would air for a song, and why the others were skipped (--live for live versions)
  settings.js   export, import or reset the settings
  voices.js     records the station IDs with the Kokoro speech model and checks them with Whisper (how to run it is in the file)
install.sh      sets up KTV and a systemd service on a fresh clone, see Deploying to another Linux machine
data/           settings, tokens and caches (gitignored)
```

To add a transition, add a function to `transitions` in `public/transitions.js` that returns `{ cover, reveal, hidesBug }`. It joins the random rotation automatically, and number keys preview transitions in the order they're defined.

YouTube's title bar and logo are hidden in `tv.css`, not by the player. The player is made taller than the screen, so the black bands where YouTube draws them sit off-screen. The video itself isn't cropped.

## Deploying to another Linux machine

```sh
git clone <your repo url> ktv && cd ktv && bash install.sh
```

`install.sh` installs the dependencies, creates `.env` from `.env.example` with a random `ACCESS_KEY` if none exists yet, and sets up a `systemd --user` service so KTV starts now, restarts if it ever crashes, and comes back on reboot. It prints the SSH tunnel command to reach `/admin` with, since Spotify and Google only send logins back to `127.0.0.1`.

To update later: `git pull && npm ci --omit=dev && systemctl --user restart ktv`.

Useful commands: `systemctl --user status ktv`, `journalctl --user -u ktv -f` (logs), `systemctl --user stop ktv`.

To reach `/tv` from other screens on the network, open it by hostname, never by the machine's IP address — see [Videos won't play](#videos-wont-play-error-150-in-the-server-log).

### Deploying on your own domain

Run the server on something that stays on: a home server, NAS, Raspberry Pi or VPS. Put an HTTPS reverse proxy in front of it, for example with Caddy:

```
ktv.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Then, in `.env`:
1. Set `BASE_URL=https://ktv.example.com` and restart (`systemctl --user restart ktv`).
2. Register `https://ktv.example.com/auth/callback` in your Spotify app, and `https://ktv.example.com/auth/youtube/callback` in your Google Cloud client if you use YouTube (the control room shows the exact URIs).
3. Open TVs on `https://ktv.example.com/tv`, never by IP.

A home machine works best. YouTube is more likely to challenge keyless searches that come from datacenter IPs. If that happens on a VPS, add a YouTube Data API key in the control room.

## Known limitations

- **Some videos can't be embedded at all**, because the owner disabled it. KTV skips them and remembers never to use them again.
- **End-screen covers depend on data from YouTube's app API.** If YouTube stops providing it for a video, that video's end-screen thumbnails can show before the cut.
- **The still-picture check needs a storyboard.** YouTube has one for nearly every video. For a video without one, only its title and channel are checked.
- **Albums and years come from MusicBrainz**, a volunteer-run database. Small or very new releases can be missing (the service's album shows then), and while MusicBrainz is overloaded, a title card can fall back to the service's details until the song's next airing.
- **Each music service has its catch.** Google ends the YouTube login after 7 days while your Google Cloud app is in testing, Apple Music needs a paid developer membership, Deezer only shows public profiles, and Last.fm only knows song names, so those songs get their album and year from MusicBrainz alone.
- **YouTube can change its embedded player at any time.** The March 2026 redesign added the center play/pause button that transitions now wait out. A future change could need another workaround.
- **The logo, transitions and covers sit on top of the YouTube player, and YouTube's branding is pushed off-screen.** YouTube's API policies don't allow that in public apps. It's fine for a private screen, but don't turn this into a public service as is.
- **Title cards use artist, title, album and year.** Spotify no longer returns record labels.

## Reference: the look KTV is imitating

- MTV idents, 1981–1983: https://www.youtube.com/watch?v=pcHoKf_w1HE
- MTV ident archive, 1981–1989: https://www.youtube.com/watch?v=F4jaBb7X0V8
- MTV ident bumpers, 90s: https://www.youtube.com/watch?v=zZFVKBUDgk8
- 230 MTV IDs, idents, adverts and bumpers: https://www.youtube.com/watch?v=3u_UQoMViEM (also on the Internet Archive: https://archive.org/details/230MTVIDIdentsAdvertsBumpers)
- MTV Ident Collection playlist, 80s–2000s: https://www.youtube.com/playlist?list=PL3B_RgAMWfrK6RGfWNBbd2OUe9HqrPcku
- MTV 80s (Europe) bumpers and idents: https://www.youtube.com/watch?v=QHJrCO5hjck
- How MTV used type in its lower thirds: https://typenetwork.com/articles/mtv
