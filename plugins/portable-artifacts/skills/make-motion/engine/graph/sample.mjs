// Resolve a scene graph at time t: sampleGraph(nodes, t) returns the same tree with every animatable prop
// a plain value. Children stay nested and keep local values (nothing is pre-multiplied). stateKey() makes a
// stable string of a sampled tree so the renderer can skip a frame that equals the previous one.
import { sample } from '../time/track.mjs';
import { isNode, TRACK_NAMES } from './node.mjs';

const DEFAULTS = Object.freeze({ x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0 });
const WORD_DEFAULTS = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

// Each name takes its track if there is one, else the static value, else the default.
function resolve(names, tracks, statics, defaults, t, step) {
  const out = {};
  for (const name of names) {
    if (tracks[name]) out[name] = sample(tracks[name], t, step);
    else if (statics[name] !== undefined) out[name] = statics[name];
    else if (defaults[name] !== undefined) out[name] = defaults[name];
  }
  return out;
}

function sampleWords(n, t) {
  const names = [...Object.keys(WORD_DEFAULTS), 'fill'];
  const statics = { fill: n.props.fill };
  return Object.freeze(n.wordTracks.map((entry) => Object.freeze(resolve(names, entry, statics, WORD_DEFAULTS, t, n.step))));
}

function sampleNode(n, t) {
  if (!isNode(n)) throw new Error('sampleGraph needs nodes built by node()');
  const values = resolve(TRACK_NAMES, n.tracks, n.props, DEFAULTS, t, n.step);
  const statics = Object.fromEntries(Object.entries(n.props).filter(([name]) => !TRACK_NAMES.includes(name)));
  const sampled = {
    type: n.type,
    id: n.id,
    depth: n.depth,
    props: Object.freeze(statics),
    ...values,
    visible: values.opacity > 0,
    children: Object.freeze(n.children.map((child) => sampleNode(child, t))),
  };
  if (n.wordTracks.length > 0) sampled.words = sampleWords(n, t);
  return Object.freeze(sampled);
}

export function sampleGraph(nodes, t) {
  if (!Array.isArray(nodes)) throw new Error('sampleGraph needs an array of nodes');
  if (typeof t !== 'number' || !Number.isFinite(t)) throw new Error(`sample time must be a finite number, got ${t}`);
  return Object.freeze(nodes.map((n) => sampleNode(n, t)));
}

// JSON with object keys sorted at every depth; undefined members are dropped, as JSON.stringify does.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, stable(v[k])]));
}

export function stateKey(sampled) {
  return JSON.stringify(stable(sampled));
}
