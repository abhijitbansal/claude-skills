// *.diagram.json: JSON Schema (structure and closed sets) plus the limits the
// semantic checks in spec.mjs enforce. Lengths, counts and id spelling are
// checked there instead, so their messages can state the value and the limit.
import { TYPES } from './kinds.mjs';

export const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
export const TONES = ['neutral', 'accent', 'good', 'warn', 'bad'];
export const EDGE_STYLES = ['solid', 'dashed', 'async'];
export const DIRECTIONS = ['right', 'down'];
export const MESSAGE_KINDS = ['sync', 'async', 'reply', 'self'];
export const FRAME_KINDS = ['loop', 'alt', 'opt', 'par'];

export const LIMITS = Object.freeze({
  nodes: 60,
  edges: 120,
  steps: 25,
  participants: 12,
  messages: 60,
  stories: 8,
  beats: 60,
  title: 120,
  subtitle: 160,
  label: 48,
  note: 60,
  detail: 400,
  edgeLabel: 40,
  stepTitle: 60,
  stepNote: 200,
  storyTitle: 40,
  beatTitle: 48,
  caption: 160,
  groupDepth: 3,
});

// \S: at least one non-space character (also rejects ""). spec.mjs words the error.
export const NON_SPACE = '\\S';
const text = { type: 'string', pattern: NON_SPACE };
const ids = { type: 'array', items: text };
const someIds = { type: 'array', minItems: 1, items: text };

function object(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

export const SCHEMA = object(['title', 'type'], {
  title: text,
  subtitle: text,
  type: { enum: TYPES },
  theme: text,
  direction: { enum: DIRECTIONS },
  animate: { type: 'boolean' },
  autoplay: { type: 'boolean' },
  groups: { type: 'array', items: object(['id', 'label'], { id: text, label: text, parent: text }) },
  nodes: {
    type: 'array',
    items: object(['id', 'label'], {
      id: text, label: text, kind: text, icon: text, group: text, note: text, tone: { enum: TONES }, emoji: text, detail: text,
    }),
  },
  edges: {
    type: 'array',
    items: object(['from', 'to'], {
      id: text, from: text, to: text, label: text, style: { enum: EDGE_STYLES }, both: { type: 'boolean' },
    }),
  },
  participants: {
    type: 'array',
    items: object(['id', 'label'], { id: text, label: text, kind: text, icon: text, emoji: text, detail: text }),
  },
  messages: {
    type: 'array',
    items: object(['id', 'from', 'to'], {
      id: text, from: text, to: text, label: text, kind: { enum: MESSAGE_KINDS },
    }),
  },
  frames: {
    type: 'array',
    items: object(['kind', 'messages'], { kind: { enum: FRAME_KINDS }, label: text, messages: someIds }),
  },
  notes: {
    type: 'array',
    items: object(['over', 'text'], { over: someIds, text, after: text }),
  },
  steps: {
    type: 'array',
    items: object(['title'], { title: text, note: text, show: ids, focus: ids, highlight: ids }),
  },
  stories: {
    type: 'array',
    items: object(['id', 'title', 'beats'], {
      id: text,
      title: text,
      beats: {
        type: 'array',
        items: object(['title'], { title: text, caption: text, edge: text, from: text, to: text, focus: ids }),
      },
    }),
  },
});
