// Browser-safe (no Node imports): audio tracks resolved to absolute video time,
// shared by the ffmpeg mix (render) and the preview player.
import { TYPING_SECONDS_PER_CHAR, typingLength } from './defaults.mjs';
import { flattenElements } from './groups.mjs';

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
export const MAX_AUDIO_TRACKS = 20;

// Procedural sound cues (scripts/lib/cues.mjs makes the sound): `cues` entries are timed like audio tracks.
export const CUE_NAMES = Object.freeze(['pop', 'click', 'whoosh', 'chime', 'impact', 'riser', 'swoosh', 'typing', 'drop', 'ding']);
export const PITCHED_CUES = Object.freeze(['pop', 'chime', 'impact', 'drop', 'ding']); // the ones a `note` tunes; the rest are noise
export const MAX_CUES = 30;
export const NOTE_PATTERN = /^[A-G][#b]?[0-8]$/;

// Absolute start of a track: `at` is relative to the named scene's start, else to the video start.
export function trackStart(track, spec) {
  if (track.scene === undefined) return track.at ?? 0;
  let cursor = 0;
  for (const scene of spec.scenes) {
    if (scene.id === track.scene) break;
    cursor += scene.duration;
  }
  return cursor + (track.at ?? 0);
}

// [{ src, start, end, volume, fadeIn, fadeOut }] with `end` = the fade-out anchor:
// the track's `duration` trim when given, clamped to the video end.
export function resolveAudio(spec) {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  return (spec.audio ?? []).map((track) => {
    const start = trackStart(track, spec);
    const end = track.duration === undefined ? total : Math.min(total, start + track.duration);
    return {
      src: track.src, start, end,
      volume: track.volume ?? 1, fadeIn: track.fadeIn ?? 0, fadeOut: track.fadeOut ?? 0,
    };
  });
}

// Where a `typing` cue with `follow` plays: { el, scene, start, chars, spacing } for the element `id`, or null when no
// scene has an element with that id. It starts when the text starts typing (its scene start plus its first `value`
// keyframe, 0 without one) and clicks once per character typed, `spacing` seconds apart: `chars` is that number of
// clicks. With `value` keyframes the clicks are the characters typed between the first `value` keyframe and the first
// one that reaches the whole text (else the last `value` keyframe), spread evenly between the two: under an ease the
// characters arrive unevenly, so the clicks only approximate them. `chars` is 0 (and `spacing` the default pace) when
// the text never types a character: empty text, one `value` keyframe, or keyframes that never rise.
export function typingFollow(spec, id) {
  let sceneStart = 0;
  for (const scene of spec.scenes) {
    const el = flattenElements(scene.elements).find((f) => f.el.id === id)?.el; // a typing text may sit in a group
    if (el) {
      const chars = typingLength(typeof el.text === 'string' ? el.text : '');
      const keyed = (el.keyframes ?? []).filter((kf) => kf.value !== undefined);
      if (!keyed.length) return { el, scene, start: sceneStart, chars, spacing: TYPING_SECONDS_PER_CHAR };
      const done = keyed.find((kf) => kf.value >= chars) ?? keyed.at(-1);
      const span = done.t - keyed[0].t;
      const clicks = Math.max(0, Math.floor(Math.min(done.value, chars)) - Math.max(0, Math.floor(keyed[0].value)));
      const typed = span > 0 && clicks > 0;
      return { el, scene, start: sceneStart + keyed[0].t, chars: typed ? clicks : 0, spacing: typed ? span / clicks : TYPING_SECONDS_PER_CHAR };
    }
    sceneStart += scene.duration;
  }
  return null;
}

// [{ cue, note, pan, start, volume, chars, spacing }] with `start` in absolute video seconds; `volume` is a literal
// gain. `chars` and `spacing` (seconds between key clicks) are read by `typing` only: one click unless it follows a text.
export function resolveCues(spec) {
  return (spec.cues ?? []).map((c) => {
    const base = { cue: c.cue, note: c.note, pan: c.pan ?? 0, volume: c.volume ?? 1 };
    if (c.follow === undefined) return { ...base, start: trackStart(c, spec), chars: 1, spacing: TYPING_SECONDS_PER_CHAR };
    const typing = typingFollow(spec, c.follow);
    if (!typing) throw new Error(`cue follows element ${JSON.stringify(c.follow)}, which no scene has`);
    return { ...base, start: typing.start, chars: typing.chars, spacing: typing.spacing };
  });
}
