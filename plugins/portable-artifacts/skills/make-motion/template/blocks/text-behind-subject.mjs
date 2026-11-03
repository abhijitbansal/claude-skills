// text-behind-subject: big text that sits behind a person. Three layers in one frame: the picture (a photo or a clip), the
// text, and the same picture with everything but the person cut out (scripts/cutout.mjs writes it) on top of the text.
// Both pictures take the same frame and `cover` fit, so the person lines up exactly.
import { unit, contentWidth, fitHeight, squeeze, slot, textPart, enter, blockGroup, freeBand, roomAt, abovePlace, MIN_TEXT, LINE_HEIGHT } from './layout.mjs';
import { isVideoSrc } from '../media.mjs';

const COLORS = ['text', 'text2', 'accent', 'good'];
const DEFAULT_SIZE = 300; // px at 1080: the largest the text gets unless `fontSize` says otherwise
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['src', 'cutout', 'text'],
  properties: {
    src: { type: 'string', minLength: 1, maxLength: 80 },
    cutout: { type: 'string', minLength: 1, maxLength: 80 },
    text: { type: 'string', minLength: 1, maxLength: 40 },
    fontSize: { type: 'number', minimum: 40, maximum: 400, default: DEFAULT_SIZE },
    color: { enum: COLORS, default: 'text' },
  },
};

const FRAME_CAP = 1700; // px at 1080: the frame's widest
const MAX_ASPECT = 1.5; // the frame is at most this much taller than wide
const TEXT_WIDTH_SHARE = 0.92; // of the frame
const TEXT_HEIGHT_SHARE = 0.45; // of the frame: the text never takes more than this
const TEXT_CENTRE = -0.16; // of the frame height from its middle: where a head usually is
const EDGE = 12; // px at 1080 kept between the text and the frame's top edge
const SIZE_STEP = 0.9; // the ladder of text sizes from the cap down
const OPAQUE_IMAGES = ['jpg', 'jpeg']; // formats that cannot hold transparency: a cutout in one is a mistake
const OPAQUE_CLIPS = ['mp4', 'm4v'];

const extOf = (src) => src.slice(src.lastIndexOf('.') + 1).toLowerCase();
const kindName = (src) => (isVideoSrc(src) ? 'clip' : 'photo');

// A media element for `src`, cover-fitted into the frame: a `video` when its extension says so (the original keeps its sound
// and the cutout is muted so it never doubles it), else an `image`.
function media(id, src, frame, { mute = false } = {}) {
  const base = { id, src, x: 0, y: 0, width: frame.width, height: frame.height, fit: 'cover' };
  return isVideoSrc(src) ? { ...base, type: 'video', ...(mute ? { mute: true } : {}) } : { ...base, type: 'image' };
}

// Sizes from `cap` down to `floor`, largest first, as whole px.
function ladder(cap, floor) {
  const sizes = [];
  for (let s = cap; s > floor; s *= SIZE_STEP) sizes.push(Math.round(s));
  return [...new Set([...sizes, floor])].sort((a, b) => b - a);
}

// What the schema cannot say: the cutout is another file of the same kind as src, and not a format that cannot hold transparency.
function validate(p) {
  const at = (message) => [{ path: 'cutout', message }];
  if (p.cutout === p.src) return at('is the same file as src; run node scripts/cutout.mjs on src and name the file it prints');
  if (isVideoSrc(p.src) !== isVideoSrc(p.cutout)) return at(`src is a ${kindName(p.src)} but cutout is a ${kindName(p.cutout)}; cut out a ${kindName(p.src)} into a ${isVideoSrc(p.src) ? 'WebM' : 'PNG'} with node scripts/cutout.mjs`);
  const ext = extOf(p.cutout);
  if (isVideoSrc(p.cutout) && OPAQUE_CLIPS.includes(ext)) return at(`an ${ext.toUpperCase()} clip has no transparency; use the WebM that node scripts/cutout.mjs writes`);
  if (!isVideoSrc(p.cutout) && OPAQUE_IMAGES.includes(ext)) return at('a JPEG has no transparency; use the PNG that node scripts/cutout.mjs writes');
  return [];
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { src, cutout, text, fontSize = DEFAULT_SIZE, color = params.properties.color.default } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const width = Math.max(1, Math.round(contentWidth(size, FRAME_CAP * u, 0, ctx.insets)));
  const room = roomAt(freeBand(ctx), el.y);
  const height = Math.max(1, Math.round(Math.min(room, width * MAX_ASPECT)));
  const frame = { width, height };
  const maxWidth = width * TEXT_WIDTH_SHARE;
  const fit = fitHeight(text, { sizes: ladder(Math.round(fontSize * u), Math.max(1, Math.round(MIN_TEXT * u))), maxWidth, maxHeight: height * TEXT_HEIGHT_SHARE, lineHeight: LINE_HEIGHT.title });
  const y = Math.max(TEXT_CENTRE * height, -height / 2 + fit.height / 2 + EDGE * u);
  const at = squeeze(sceneDuration, slot(1)[1]);
  const span = (i) => slot(i).map(at);
  return blockGroup(el, [
    enter(media(id('photo'), src, frame), span(0)),
    enter(textPart(id('text'), text, 0, y, { fontSize: fit.fontSize, maxWidth, fontWeight: 800, role: 'title', color }), span(1)),
    enter(media(id('subject'), cutout, frame, { mute: true }), span(0)),
  ]);
}

const PARAM_OF = { photo: 'src', text: 'text', subject: 'cutout' }; // part -> param, for check.mjs hints

export default Object.freeze({
  summary: 'big text behind a person: a photo or clip, the text, then the person cut out of it on top (node scripts/cutout.mjs makes the cutout)',
  params,
  describe: {
    src: 'the original photo (png, jpg, jpeg or webp) or clip (mp4, mov, webm or m4v), relative to the spec file; a clip keeps its sound',
    cutout: 'the same picture with only the person left, from node scripts/cutout.mjs: a PNG for a photo, a WebM for a clip; it must be the same size and length as src',
    text: 'the words behind the person, up to 40 characters; they shrink to fit the frame',
    fontSize: 'the largest the text may be, in px at 1080, 40 to 400 (default 300)',
    color: 'text, text2, accent or good: the theme colour of the words (default text)',
  },
  example: { src: 'portrait.jpg', cutout: 'portrait-cutout.png', text: 'UNSTOPPABLE' },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  assets: ['src', 'cutout'],
  hook: ['text'],
  validate,
  paramOf: (part) => (Object.hasOwn(PARAM_OF, part) ? PARAM_OF[part] : null),
  expand,
});
