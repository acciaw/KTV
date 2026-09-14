// text matching shared by the video and release lookups

export const normalize = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const compact = (s) => normalize(s).replace(/ /g, '');

// "song - 2011 remaster" or "song (feat x)" becomes "song"
export const baseTitle = (title) => title.replace(/\s+[-–]\s+.*$/, '').replace(/\s*[([].*?[)\]]/g, '').trim() || title;

// artist or channel name stripped of case, spaces, accents, "&" and a leading "the"
export function nameKey(name) {
  const plain = name.replace(/&/g, ' and ').replace(/^the\s+/i, '');
  return compact(plain) || plain.toLowerCase().replace(/\s+/g, '');
}
