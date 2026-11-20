// The render page's video clip frames. /film.json lists the film's clips ({ src, count, width, height, from, fps }); the
// server serves frame n of the k-th at /clip/<k>/<n> (scripts/v2/clips.mjs decoded them with ffmpeg, so the same film
// always draws the same frames). Before a frame is drawn, prepare(state) loads every clip frame its nodes show (the
// incoming and outgoing shots of a cut, each smear sample) and keeps a bounded cache; frames(src, n) hands the draw a
// loaded frame and throws for one that is not loaded, so a missing frame is an error, never a blank picture.
import { frameIndexOf } from '../kinds/media-clip.mjs';

const CACHE_MAX = 48; // decoded frames kept: a cut window's two shots and a smear's samples fit with room to spare

// Every { src, n } the sampled trees show.
function shownFrames(trees) {
  const found = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.props?.video) found.push({ src: n.props.src, n: frameIndexOf(n.frame ?? 0, n.props.video.count) });
      walk(n.children ?? []);
    }
  };
  trees.forEach(walk);
  return found;
}

// The sampled trees of a frame state (engine/graph/film.mjs frameAt): its own, the outgoing shot's, a smear's.
const treesOf = (state) => [state.sampled, state.from?.sampled ?? [], ...(state.smear ? [...state.smear.layers, state.smear.over, state.smear.whole] : [])];

export function createClipFrames(clips) {
  const index = new Map(clips.map((c, k) => [c.src, k]));
  const cache = new Map(); // `${src}\n${n}` -> ImageBitmap, oldest first
  const key = (src, n) => `${src}\n${n}`;
  const load = async (src, n) => {
    const res = await fetch(`/clip/${index.get(src)}/${n}`);
    if (!res.ok) throw new Error(`clip "${src}": frame ${n} could not be loaded: HTTP ${res.status}`);
    return createImageBitmap(await res.blob());
  };
  return {
    // what ctx.asset(src) says of each clip: its frame size and its decoded frames
    entries: clips.map((c) => [c.src, { width: c.width, height: c.height, clip: { from: c.from, fps: c.fps, count: c.count } }]),
    frames: (src, n) => {
      const bitmap = cache.get(key(src, n));
      if (!bitmap) throw new Error(`clip "${src}": frame ${n} was not loaded before the draw`);
      return bitmap;
    },
    async prepare(state) {
      const wanted = shownFrames(treesOf(state));
      const keep = new Set(wanted.map(({ src, n }) => key(src, n)));
      for (const { src, n } of wanted) {
        if (!index.has(src)) throw new Error(`clip "${src}" is not one of the film's clips`);
        if (!cache.has(key(src, n))) cache.set(key(src, n), await load(src, n));
      }
      for (const [k, bitmap] of cache) {
        if (cache.size <= CACHE_MAX) break;
        if (keep.has(k)) continue;
        bitmap.close();
        cache.delete(k);
      }
    },
  };
}
