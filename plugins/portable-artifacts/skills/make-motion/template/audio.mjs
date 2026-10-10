// Browser-safe (no Node imports): audio tracks resolved to absolute video time,
// shared by the ffmpeg mix (render) and the preview player.
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
export const MAX_AUDIO_TRACKS = 20;

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
