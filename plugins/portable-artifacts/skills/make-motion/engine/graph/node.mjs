// Scene graph nodes for the v2 engine: node(type, id, props, opts) builds an immutable Node.
// Animatable props are a static value in `props` or a Track in `tracks` (a track wins). Rotation is in
// degrees. Pure and DOM-free.

export const NODE_TYPES = Object.freeze(['group', 'text', 'path', 'image', 'field']);
export const TRACK_NAMES = Object.freeze(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity', 'draw', 'reveal', 'blur']);
// `ghost` is never drawn: above 0 it marks a word not yet spoken in a mode that reads from frame 0 (kinds/shared.mjs
// ghostTracks), so the contrast rule leaves it alone (engine/review/contrast.mjs).
// `glow` (0 to 1) lights a word's glyph glow, the text's props.glow ({ color, alpha, radius }), to that share of its alpha.
export const WORD_TRACK_NAMES = Object.freeze(['opacity', 'x', 'y', 'scale', 'fill', 'ghost', 'glow']);

const COLOUR_WORD_TRACKS = Object.freeze(['fill']);
const created = new WeakSet();

const list = (names) => names.join(', ');
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTrack = (v) => isPlainObject(v) && Array.isArray(v.points) && v.points.length > 0 && typeof v.kind === 'string';

// True for a value node() returned.
export const isNode = (v) => created.has(v);

// Copy plain objects and arrays and freeze the copy, so the caller's data is never frozen or aliased.
function freezeCopy(v) {
  if (Object.isFrozen(v)) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(freezeCopy));
  if (!isPlainObject(v)) return v;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, val]) => [k, freezeCopy(val)])));
}

function checkTrackMap(map, allowed, where, colourNames = []) {
  if (!isPlainObject(map)) throw new Error(`${where} must be an object of tracks`);
  for (const [name, tr] of Object.entries(map)) {
    if (!allowed.includes(name)) throw new Error(`${where}: unknown track '${name}'; accepted: ${list(allowed)}`);
    if (!isTrack(tr)) throw new Error(`${where}.${name} must be a track (see track())`);
    const wantKind = colourNames.includes(name) ? ['colour', 'string'] : ['number'];
    if (!wantKind.includes(tr.kind)) throw new Error(`${where}.${name} must be a ${wantKind.join(' or ')} track, got ${tr.kind}`);
  }
}

function checkStaticProps(props) {
  if (!isPlainObject(props)) throw new Error('props must be an object');
  for (const name of TRACK_NAMES) {
    if (name in props && !isFiniteNumber(props[name])) throw new Error(`props.${name} must be a finite number, got ${props[name]}`);
  }
}

function checkWordTracks(words, type) {
  if (!Array.isArray(words)) throw new Error('wordTracks must be an array, one entry per word index');
  if (words.length > 0 && type !== 'text') throw new Error(`wordTracks only apply to a text node, not '${type}'`);
  words.forEach((entry, i) => checkTrackMap(entry, WORD_TRACK_NAMES, `wordTracks[${i}]`, COLOUR_WORD_TRACKS));
}

function checkChildren(children) {
  if (!Array.isArray(children)) throw new Error('children must be an array of nodes');
  children.forEach((child, i) => {
    if (!isNode(child)) throw new Error(`children[${i}] must be a node built by node()`);
  });
}

function checkOptions({ depth, step }) {
  if (depth !== undefined && (!isFiniteNumber(depth) || depth <= -1)) throw new Error(`depth must be a finite number > -1 (0 is the picture plane), got ${depth}`);
  if (step !== undefined && (!isFiniteNumber(step) || step <= 0)) throw new Error(`step must be a finite frame rate > 0, got ${step}`);
}

export function node(type, id, props = {}, opts = {}) {
  if (!NODE_TYPES.includes(type)) throw new Error(`unknown node type '${type}'; accepted: ${list(NODE_TYPES)}`);
  if (typeof id !== 'string' || id.length === 0) throw new Error(`node id must be a non-empty string, got ${JSON.stringify(id)}`);
  const { tracks = {}, children = [], depth = 0, step, wordTracks = [] } = opts;
  checkStaticProps(props);
  checkTrackMap(tracks, TRACK_NAMES, 'tracks');
  checkWordTracks(wordTracks, type);
  checkChildren(children);
  checkOptions({ depth, step });
  const made = Object.freeze({
    type,
    id,
    props: freezeCopy(props),
    tracks: Object.freeze({ ...tracks }),
    children: Object.freeze([...children]),
    depth,
    step,
    wordTracks: Object.freeze(wordTracks.map((entry) => Object.freeze({ ...entry }))),
  });
  created.add(made);
  return made;
}
