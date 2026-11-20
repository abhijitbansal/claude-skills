// A video clip in the `media` kind: which srcs are clips, and which of a clip's decoded frames a shot shows when. The
// clip is decoded once by scripts/v2/clips.mjs at the film's fps, from `from` (the earliest `in` any shot gives that
// file) for `count` frames; frame k is the clip at second from + k / fps. A shot plays its clip from its own `in` for
// as long as it runs, up to its `out`, then holds that frame. The picture's image node carries a `frame` track (the
// decoded frame as a number, rising one per film frame) and `props.video` ({ count }); engine/page/draw.mjs takes
// frameIndexOf(value, count). Pure and DOM-free.
import { track } from '../time/track.mjs';

export const CLIP_EXTENSIONS = Object.freeze(['mp4', 'mov', 'm4v', 'webm', 'mkv']);
const FRAME_EPSILON = 1e-6; // a frame value a hair under its integer (float noise) still shows that frame

const extensionOf = (src) => (/\.([a-z0-9]+)$/i.exec(src)?.[1] ?? '').toLowerCase();

/** Whether `src` names a clip (by its extension); the file's content is checked by clips.mjs before it is used. */
export const isClipSrc = (src) => typeof src === 'string' && CLIP_EXTENSIONS.includes(extensionOf(src));

/** The decoded frame a frame value shows: its integer part, kept inside the decoded frames. */
export const frameIndexOf = (value, count) => Math.min(count - 1, Math.max(0, Math.floor(value + FRAME_EPSILON)));

// The shot's seconds of clip: from its in to its out (the clip's end when it gives none), no longer than the shot.
const spanOf = (use, duration) => Math.min(duration, (use.out ?? Infinity) - (use.in ?? 0));

/**
 * The `frame` track of a shot's clip picture: from the shot's `in` (as a decoded frame) at the shot's second 0, one frame
 * per film frame, held from the end of its span.
 * @param {{ from: number, fps: number }} clip @param {{ in?: number, out?: number }} use @param {number} duration the shot's seconds
 */
export function clipFrameTrack(clip, use, duration) {
  const start = ((use.in ?? 0) - clip.from) * clip.fps;
  const span = spanOf(use, duration);
  return track([{ t: 0, v: start }, { t: span, v: start + span * clip.fps }]);
}

/** The decoded frame shot `use` shows at its second `t` (what clipFrameTrack sampled at t gives, as an index). */
export function clipFrameIndex(clip, use, t) {
  const start = ((use.in ?? 0) - clip.from) * clip.fps;
  return frameIndexOf(start + Math.min(Math.max(t, 0), spanOf(use, Infinity)) * clip.fps, clip.count);
}
