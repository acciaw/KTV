# KTV — your own music television

Open `/tv` on any screen (projector, TV browser, laptop) and KTV runs non-stop music videos picked from your music on Spotify, YouTube, Apple Music, Deezer or Last.fm. It adds a restyling station logo in the corner, title cards, and MTV-style transitions between clips. Close the tab and it stops.

The channel is named after you, and the logo adapts.

- **Your music services** are only used to read what to play (liked songs, playlists, top tracks). Nothing plays on your accounts, so you can keep listening at the same time.
- **YouTube** provides the video, through the official IFrame player running in the browser. Each song gets its official music video, and every pick is checked against the real video before it airs. YouTube's controls, title bar, logo, captions and end screens are kept off the screen.
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
- To install on your machine:
[COMING SOON]

- To install on a linux server:
```sh
git clone https://github.com/acciaw/KTV.git ktv && cd ktv && bash install.sh
```

Then follow the instructions on screen.

## Reference: the look KTV is imitating

- MTV idents, 1981–1983: https://www.youtube.com/watch?v=pcHoKf_w1HE
- MTV ident archive, 1981–1989: https://www.youtube.com/watch?v=F4jaBb7X0V8
- MTV ident bumpers, 90s: https://www.youtube.com/watch?v=zZFVKBUDgk8
- 230 MTV IDs, idents, adverts and bumpers: https://www.youtube.com/watch?v=3u_UQoMViEM (also on the Internet Archive: https://archive.org/details/230MTVIDIdentsAdvertsBumpers)
- MTV Ident Collection playlist, 80s–2000s: https://www.youtube.com/playlist?list=PL3B_RgAMWfrK6RGfWNBbd2OUe9HqrPcku
- MTV 80s (Europe) bumpers and idents: https://www.youtube.com/watch?v=QHJrCO5hjck
- How MTV used type in its lower thirds: https://typenetwork.com/articles/mtv
