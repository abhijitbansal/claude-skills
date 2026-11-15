// The `free` kind: a shot whose scene graph is written out by hand in the film (nodes, camera, background).
// expand() turns plain node descriptions into real nodes through node() and track(). Pure and DOM-free; the
// text measure comes from ctx, so layout runs the same in the page and in a Node test.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';

const DEFAULT_BACKGROUND = '#000000';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// {x: {keys: [...]}} -> {x: Track}. `where` names the map in an error.
function buildTrackMap(map, where) {
  if (!isPlainObject(map)) throw new Error(`${where} must be an object of tracks, each { keys: [...] }`);
  return Object.fromEntries(Object.entries(map).map(([name, desc]) => {
    if (!isPlainObject(desc)) throw new Error(`${where}.${name} must be { keys: [...] }`);
    try {
      return [name, track(desc.keys)];
    } catch (err) {
      throw new Error(`${where}.${name}: ${err.message}`);
    }
  }));
}

// A text description gives `text`, `font` and `maxWidth` instead of a ready `layout`: lay it out here.
function withLayout(props, measure) {
  if (props.layout !== undefined) return props;
  if (typeof props.text !== 'string') throw new Error('a text node needs a layout, or text with font and maxWidth');
  if (!isPlainObject(props.font)) throw new Error('a text node with text needs a font ({ family, size })');
  const layout = layoutText({ text: props.text, font: props.font, maxWidth: props.maxWidth, align: props.align ?? 'left', measure, optical: props.optical === true });
  return { ...props, layout };
}

// An image description names one of the shot's `srcs` by the string written there (props.src). ctx.asset throws
// when the shot does not declare it; the node keeps the string and, unless given, takes the picture's own size.
function withAsset(props, asset) {
  if (typeof props.src !== 'string' || props.src === '') throw new Error('an image node needs props.src, one of the strings in the shot\'s srcs');
  const loaded = asset(props.src);
  return { ...props, w: props.w ?? loaded.width, h: props.h ?? loaded.height };
}

const propsFor = (type, props, ctx) => {
  if (type === 'text') return withLayout(props, ctx.measure);
  return type === 'image' ? withAsset(props, ctx.asset) : props;
};

function describe(desc, ctx) {
  if (!isPlainObject(desc)) throw new Error('a node description must be an object');
  const { type, id, props = {}, tracks, children = [], depth, step, wordTracks = [] } = desc;
  if (!Array.isArray(children)) throw new Error('children must be an array of node descriptions');
  if (!Array.isArray(wordTracks)) throw new Error('wordTracks must be an array, one track map per word index');
  return node(type, id, propsFor(type, props, ctx), {
    tracks: tracks === undefined ? {} : buildTrackMap(tracks, 'tracks'),
    children: children.map((child) => buildNode(child, ctx)),
    depth,
    step,
    wordTracks: wordTracks.map((entry, i) => buildTrackMap(entry, `wordTracks[${i}]`)),
  });
}

// Every error names the node it came from; a child's error is already named and passes through.
function buildNode(desc, ctx) {
  try {
    return describe(desc, ctx);
  } catch (err) {
    if (err.freeNodeId !== undefined) throw err;
    const named = new Error(`free: node "${desc?.id}": ${err.message}`, { cause: err });
    named.freeNodeId = desc?.id;
    throw named;
  }
}

export function expandFree(shot, ctx) {
  const { nodes = [], camera, background = DEFAULT_BACKGROUND } = shot;
  if (!Array.isArray(nodes)) throw new Error(`free: shot "${shot.id}": nodes must be an array of node descriptions`);
  if (typeof background !== 'string') throw new Error(`free: shot "${shot.id}": background must be a colour string`);
  const out = { nodes: nodes.map((desc) => buildNode(desc, ctx)), background };
  if (camera !== undefined) out.camera = buildTrackMap(camera, 'camera');
  return out;
}

registries.kinds.add('free', {
  schema: {
    properties: {
      nodes: { type: 'array' },
      camera: { type: 'object' },
      background: { type: 'string' },
      srcs: { type: 'array', items: { type: 'string' } },
    },
  },
  srcFields: ['srcs'],
  targets: () => [],
  expand: expandFree,
});
