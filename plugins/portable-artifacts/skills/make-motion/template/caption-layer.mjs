// Browser only: the captions layers of the render page. One `.captions.style-<name>` div per track, a direct child of
// #stage (above the scenes, below grain and vignette), centred in the caption zone. Nothing here is on the anime.js
// timeline: what a layer shows is a pure function of the time (captionState), set on every seek.
import { parseCaptions, trackGroups, captionState, groupText } from './captions.mjs';
import { captionZone } from './formats.mjs';
import { trackStart } from './audio.mjs';
import { graphemes } from './defaults.mjs';
import { bindWithNbsp } from '/shared/nowrap.mjs'; // served by server.mjs

const CAPTION_FONT_PX = 48; // at 1080 px on the canvas's short side
const REFERENCE_SIDE = 1080;
export const CAPTION_WEIGHT = 700;
const BACKDROP_ALPHA = 85; // percent: the pill and boxed backgrounds are the theme surface at 0.85
const BACKDROPS = new Set(['pill', 'boxed']);
const EDGE_PX = 0.25; // a capped kinetic word stays this far inside the zone

export const captionFontSize = (size) => (CAPTION_FONT_PX * Math.min(size[0], size[1])) / REFERENCE_SIDE;

/**
 * Fetches and groups every captions track of `spec` (withDefaults applied): [{ index, style, groups }], with the
 * groups on the video's clock (the track's `scene` + `at` added). `assetUrl(src)` is where the page fetches a file.
 */
export function loadCaptionTracks(spec, assetUrl) {
  return Promise.all(spec.captions.map(async (track, index) => {
    const failed = (why) => new Error(`captions[${index}].src: ${why}`);
    const response = await fetch(assetUrl(track.src), { cache: 'no-store' });
    if (!response.ok) throw failed(`failed to load ${track.src}: HTTP ${response.status}`);
    try {
      const words = parseCaptions(await response.text(), track.src.split('.').pop());
      return { index, style: track.style, groups: trackGroups(words, trackStart(track, spec)) };
    } catch (e) { throw failed(e.message); }
  }));
}

/** Every caption text of `tracks`, for the font loader. */
export const captionSample = (tracks) => tracks.flatMap((t) => t.groups.map((g) => groupText(g.words))).join(' ');

/** The layer of one track (from loadCaptionTracks), hidden until applyCaption shows a group. */
export function captionLayer(track, spec, look) {
  const zone = captionZone(spec.size, spec.format);
  const node = document.createElement('div');
  node.className = `captions style-${track.style}`;
  node.dataset.index = String(track.index);
  Object.assign(node.style, {
    left: `${(zone.left + zone.right) / 2}px`,
    top: `${(zone.top + zone.bottom) / 2}px`,
    maxWidth: `${zone.right - zone.left}px`,
    fontSize: `${captionFontSize(spec.size)}px`,
    fontWeight: String(look.weight('sans', CAPTION_WEIGHT)),
    color: look.text,
    display: 'none',
  });
  if (BACKDROPS.has(track.style)) node.style.background = `color-mix(in srgb, ${look.colors.surface} ${BACKDROP_ALPHA}%, transparent)`;
  return { node, zone, size: spec.size, index: track.index, style: track.style, groups: track.groups, shown: null, words: [], popCaps: [], typing: null };
}

/**
 * The moments check.mjs measures each layer at, as [{ index, t }]: every group's midpoint (inside the video), and for
 * kinetic every word's start, where its pop is largest.
 */
export function captionMoments(layers, duration) {
  return layers.flatMap((layer) => layer.groups.filter((g) => g.start < duration).flatMap((g) => {
    const end = Math.min(g.end, duration);
    const pops = layer.style === 'kinetic' ? g.words.map((w) => Math.max(w.start, g.start)).filter((t) => t < end) : [];
    return [(g.start + end) / 2, ...pops].map((t) => ({ index: layer.index, t }));
  }));
}

// `el`'s box in canvas pixels (the stage may be scaled to fit the window), or null before the stage is laid out.
function canvasRect(el, size) {
  const s = el.closest('#stage')?.getBoundingClientRect();
  if (!s?.width) return null;
  const k = size[0] / s.width;
  const r = el.getBoundingClientRect();
  return { left: (r.left - s.left) * k, top: (r.top - s.top) * k, right: (r.right - s.left) * k, bottom: (r.bottom - s.top) * k };
}

// The group's words as <span class="word">, separated by a space, or by U+00A0 inside a number-plus-unit token
// (bindWithNbsp keeps the text's length, so word i still starts where it did). Typewriter instead keeps two spans, the
// typed characters and the hidden rest, so the box is the whole group's from the first character.
function fillGroup(layer, group) {
  const text = bindWithNbsp(groupText(group.words));
  layer.node.replaceChildren();
  layer.words = [];
  layer.typing = null;
  if (layer.style === 'typewriter') {
    const typed = document.createElement('span');
    const rest = document.createElement('span');
    rest.style.visibility = 'hidden';
    layer.node.append(typed, rest);
    layer.typing = { chars: graphemes(text), typed, rest };
    return;
  }
  let at = 0;
  group.words.forEach((word, i) => {
    if (i > 0) layer.node.append(text[at++]);
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = text.slice(at, at + word.text.length);
    at += word.text.length;
    layer.node.append(span);
    layer.words.push(span);
  });
}

// Centred on its anchor, and shrunk to fit when a group wraps to more lines than the zone is tall (a long CJK run, or
// a big font on a short zone); `max-width` already keeps it inside the zone's width. Then, for kinetic, the largest
// pop each word can take and still stay inside the zone (a word as wide as the zone does not pop at all).
function fitGroup(layer) {
  const { node, zone, size } = layer;
  node.style.transform = 'translate(-50%, -50%)';
  const box = canvasRect(node, size);
  if (!box) return;
  const scale = Math.min(1, (zone.bottom - zone.top) / (box.bottom - box.top), (zone.right - zone.left) / (box.right - box.left));
  if (scale < 1) node.style.transform = `translate(-50%, -50%) scale(${scale})`;
  if (layer.style === 'kinetic') layer.popCaps = layer.words.map((span) => popCap(canvasRect(span, size), zone));
}

// The largest scale a word (box `r`, scaled about its centre) can take and stay EDGE_PX inside the zone; at least 1.
function popCap(r, zone) {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const hw = (r.right - r.left) / 2;
  const hh = (r.bottom - r.top) / 2;
  const room = Math.min((zone.right - EDGE_PX - cx) / hw, (cx - zone.left - EDGE_PX) / hw, (zone.bottom - EDGE_PX - cy) / hh, (cy - zone.top - EDGE_PX) / hh);
  return Math.max(1, room);
}

/** Poses a captions layer at video time `sec`. */
export function applyCaption(layer, sec) {
  const state = captionState(layer.groups, layer.style, sec);
  if (!state.group) {
    layer.node.style.display = 'none';
    layer.shown = null;
    return;
  }
  layer.node.style.display = '';
  if (state.group !== layer.shown) {
    fillGroup(layer, state.group);
    fitGroup(layer);
    layer.shown = state.group;
  }
  if (layer.typing) {
    const { chars, typed, rest } = layer.typing;
    typed.textContent = chars.slice(0, state.chars).join('');
    rest.textContent = chars.slice(state.chars).join('');
    return;
  }
  layer.words.forEach((span, k) => {
    const on = k === state.wordIndex;
    span.classList.toggle('on', on);
    const pop = on ? Math.min(state.popScale, layer.popCaps[k] ?? 1) : 1;
    if (layer.style === 'kinetic') span.style.transform = pop > 1 ? `scale(${pop})` : '';
  });
}
