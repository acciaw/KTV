// song and album names as shown on the tv, remaster and live tags stripped unless the clip really is live (lowerthird.js)

const REMASTER = /re-?master/i;
const LIVE = /\b(live|unplugged)\b/i;
// "2011 Remaster", "Remastered 2009", "Digital Remaster", "Remasterizado 2008", "Remasterisé en 2015"
const REMASTER_PHRASE = /(?:\b\d{4}\s+)?(?:\bdigital(?:ly)?\s+)?\bre-?master\p{L}*(?:\s+(?:(?:in|en|em|nel)\s+)?\d{4}\b)?/giu;
// leftover text after stripping a remaster tag that means nothing alone, like "version" or a year
const LEFTOVER = /^(?:(?:version|edition|mix|in|en|and|\d{4})\b\s*)*$|^by\b/i;
// dash between a name and its tags, skips the one inside a year range
const DASH = /((?<!\d{4})\s+[-–—]\s+|\s+[-–—]\s+(?!\d{4}))/;

// pieces alternate entries and separators, the way split with a capturing group returns them
function rebuild(pieces, clean) {
  let result = '';
  for (let i = 0; i < pieces.length; i += 2) {
    const entry = clean(pieces[i], i);
    if (entry) result += (result ? pieces[i - 1] : '') + entry;
  }
  return result;
}

function cleanEntry(entry) {
  if (!REMASTER.test(entry)) return entry;
  const rest = entry.replace(REMASTER_PHRASE, ' ').replace(/\s+/g, ' ').trim();
  return LEFTOVER.test(rest) ? '' : rest;
}

// a bracketed group or dash part, dropped whole if it mentions a live recording, otherwise just loses its remaster bits
function cleanTag(tag) {
  if (LIVE.test(tag)) return '';
  if (!REMASTER.test(tag)) return tag;
  return rebuild(tag.split(/(\s*[;/,|]\s*)/), cleanEntry);
}

function withoutTags(name) {
  if (!name || !(REMASTER.test(name) || LIVE.test(name))) return name;
  const bracketsDone = name.replace(/\s*[([]([^()[\]]*)[)\]]/g, (group, inner) => {
    const rest = cleanTag(inner);
    if (rest === inner) return group;
    return rest ? group.replace(inner, () => rest) : '';
  });
  // first part is the name itself, which can contain either word, like "Live Forever" or the album "Remasters"
  const cleaned = rebuild(bracketsDone.split(DASH), (part, i) => (i === 0 ? part : cleanTag(part)));
  return cleaned.trim() || name;
}

// song title and album as shown on the tv
export function displayNames({ title, album }) {
  const song = withoutTags(title);
  let record = withoutTags(album);
  // an album name that still mentions live is a live record, left off the card unless the song is named that way too
  if (record && LIVE.test(record) && !LIVE.test(song ?? '')) record = null;
  return { title: song, album: record };
}
