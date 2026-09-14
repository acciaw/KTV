// clip end time, before the video ends or before its end screen shows, whichever is first

// lead time before the end screen thumbnail so the transition is already covering it
export const ENDSCREEN_LEAD_SECONDS = 1;

export function clipEnd({ duration, start = 0, endCutSeconds = 10, maxClipSeconds = 0, endscreen = [] }) {
  const firstThumbnail = endscreen.length ? Math.min(...endscreen.map((element) => element.startMs / 1000)) : Infinity;
  let end = Math.min(duration - endCutSeconds, firstThumbnail - ENDSCREEN_LEAD_SECONDS);
  end = Math.max(end, Math.min(duration, start + 30));
  if (maxClipSeconds > 0) end = Math.min(end, start + maxClipSeconds);
  return end;
}
