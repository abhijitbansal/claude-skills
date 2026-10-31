// Browser-safe (no Node imports): which files the spec treats as video. scripts/lib/video.mjs re-exports the list for
// the validator and the decoder; blocks that draw a media file as an `image` or a `video` by its extension use isVideoSrc.
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

/** Whether `src` is a path whose extension (case-insensitive) is one of VIDEO_EXTENSIONS. */
export function isVideoSrc(src) {
  if (typeof src !== 'string') return false;
  const dot = src.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXTENSIONS.includes(src.slice(dot + 1).toLowerCase());
}
