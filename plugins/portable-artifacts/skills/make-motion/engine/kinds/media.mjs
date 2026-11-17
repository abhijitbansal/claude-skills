// The `media` kind: one still photo, full bleed (`fit: bleed`, the default) or as a cut-out object (`fit: cutout`),
// treated in the look's duotone or halftone (`treatment`, default look.kinds.media.treatment; engine/devices/treatments.mjs),
// cropped around `focus`, with a caption that arrives with the narration and a small credit. The picture always moves on
// its own track (a slow push), so a shot with no caption is not a still in a look whose camera is locked. A clip is
// refused: the engine has no video frames yet. How each look composes it is look data (look.kinds.media); the layout is
// media-layout.mjs. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { treatmentsOf } from '../devices/treatments.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { bleedLayout, cutoutLayout, isBleed } from './media-layout.mjs';
import { unmarked } from './shared.mjs';

const KIND = 'media';
const CAPTION_MAX = 60;
const CREDIT_MAX = 40;
const STILLS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const CLIPS = Object.freeze(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
const CLIP_MESSAGE = `a clip is not supported yet; give a still (${STILLS.join(', ')})`;
const extensionOf = (src) => (/\.([a-z0-9]+)$/i.exec(src)?.[1] ?? '').toLowerCase();

function srcProblems(shot) {
  if (typeof shot.src !== 'string') return [];
  const ext = extensionOf(shot.src);
  if (CLIPS.includes(ext)) return [{ path: 'src', message: CLIP_MESSAGE }];
  if (!STILLS.includes(ext)) return [{ path: 'src', message: `must be a still (${STILLS.join(', ')}), got ${JSON.stringify(shot.src)}` }];
  return [];
}

const focusProblems = (shot) => (shot.focus ?? []).flatMap((v, i) => (v >= 0 && v <= 1 ? [] : [{ path: `focus.${i}`, message: 'must be from 0 to 1' }]));

function treatmentProblems(shot, look) {
  if (!look || shot.treatment === undefined) return [];
  const has = treatmentsOf(look);
  return has.includes(shot.treatment) ? [] : [{ path: 'treatment', message: `the ${look.name} look has no "${shot.treatment}"; it has: ${has.join(', ')}` }];
}

function mediaProblems(shot, { look } = {}) {
  return [...kindSupportProblems(KIND, look), ...srcProblems(shot), ...focusProblems(shot), ...treatmentProblems(shot, look)];
}

function expandMedia(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const laid = isBleed(shot) ? bleedLayout(shot, { ...ctx, data }) : cutoutLayout(shot, { ...ctx, data });
  const devices = onDevices(shot, ctx, { boxes: laid.boxes, defaultTarget: 'picture' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: laid.boxes,
    hero: laid.hero,
    background: look.palette.paper,
  };
}

// The field a node shows: the picture (src), the caption, the credit; null for the plates and cards they sit on.
function mediaField(shot, id) {
  if (id === `${shot.id}.caption`) return 'caption';
  if (id === `${shot.id}.credit`) return 'credit';
  if (id === `${shot.id}.picture` || id.startsWith(`${shot.id}.picture.`)) return 'src';
  return undefined;
}

registries.kinds.add(KIND, {
  summary: 'One still photo, full bleed or as a cut-out, in the look\'s duotone or halftone, with a caption that arrives with the narration and a small credit. Stills only: a clip is not supported yet.',
  example: { id: 'catch', show: KIND, src: 'assets/screenshot.png', say: 'Every morning the boats bring in the catch.', caption: 'The morning catch' },
  schema: {
    required: ['src'],
    properties: {
      src: { type: 'string', minLength: 1 },
      fit: { enum: ['bleed', 'cutout'] },
      treatment: { enum: ['none', 'duotone', 'halftone'] },
      focus: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      caption: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: CAPTION_MAX },
      credit: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: CREDIT_MAX },
    },
  },
  srcFields: ['src'],
  // fields that change how the others are drawn and are never drawn themselves (the look bar, test/v2/helpers/bar.mjs)
  steeringFields: ['fit', 'treatment', 'focus'],
  heroTarget: 'picture',
  targets: (shot) => ['picture', ...(shot.caption === undefined ? [] : ['caption'])],
  ids: (shot) => [`${shot.id}.picture`],
  nodeField: mediaField,
  validate: mediaProblems,
  expand: (shot, ctx) => expandMedia(unmarked(shot), ctx),
  lookData: true, // a look ships it only with a kinds.media entry (engine/looks/index.mjs listedKinds)
  numbered: false,
  // with a caption its words are on screen as they are spoken: never captioned; without one, the narration is captioned
  showsWords: (shot) => shot.caption !== undefined,
});
