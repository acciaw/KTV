// demo lineup, played until a music service is connected
const demo = [
  ['a-ha', 'Take On Me', 'Hunting High and Low', '1985'],
  ['The Buggles', 'Video Killed the Radio Star', 'The Age of Plastic', '1979'],
  ['Peter Gabriel', 'Sledgehammer', 'So', '1986'],
  ['Dire Straits', 'Money for Nothing', 'Brothers in Arms', '1985'],
  ['Nirvana', 'Smells Like Teen Spirit', 'Nevermind', '1991'],
  ['Beastie Boys', 'Sabotage', 'Ill Communication', '1994'],
  ['Blur', 'Song 2', 'Blur', '1997'],
  ['Daft Punk', 'Around the World', 'Homework', '1997'],
  ['Fatboy Slim', 'Praise You', "You've Come a Long Way, Baby", '1998'],
  ['OutKast', 'Hey Ya!', 'Speakerboxxx/The Love Below', '2003'],
  ['Gorillaz', 'Feel Good Inc.', 'Demon Days', '2005'],
  ['Tame Impala', 'The Less I Know The Better', 'Currents', '2015'],
];

export const demoTracks = demo.map(([artist, title, album, year]) => ({
  key: `demo:${artist}|${title}`.toLowerCase(),
  title,
  artists: [artist],
  album,
  year,
  durationMs: null,
  image: null,
  source: 'demo',
}));
