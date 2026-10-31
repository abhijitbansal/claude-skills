// logo-outro: the logo image settling into place, then an optional tagline under it; a closing card.
import { unit, contentWidth, fitText, squeeze, slot, textPart, enter, blockGroup, stack, freeBand, roomAt, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['src'],
  properties: {
    src: { type: 'string', minLength: 1, maxLength: 80 },
    tagline: { type: 'string', minLength: 1, maxLength: 80 },
    width: { type: 'number', minimum: 40, maximum: 1600, default: 480 },
  },
};

const BOX_ASPECT = 0.5; // the logo is fitted (contain) into a box `width` wide and half as tall

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { src, tagline } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const area = contentWidth(size, Infinity, 40 * u);
  const tagFit = tagline && fitText(tagline, { size: 48 * u, min: MIN_TEXT * u, maxWidth: area, maxLines: 2 });
  // The box is as wide as asked, within the safe area, and no taller than the room around y leaves beside the tagline.
  const tall = roomAt(freeBand(ctx), el.y) - (tagFit ? tagFit.height + 40 * u : 0);
  const width = Math.max(1, Math.min(el.params.width ?? params.properties.width.default, area, tall / BOX_ASPECT));
  const height = width * BOX_ASPECT;
  const ys = stack([height, ...(tagFit ? [tagFit.height] : [])], [40 * u]);
  const at = squeeze(sceneDuration, slot(tagFit ? 1 : 0)[1]);
  const logo = { id: id('logo'), type: 'image', src, x: 0, y: Math.round(ys[0]), width: Math.round(width), height: Math.round(height), fit: 'contain' };
  const parts = [enter(logo, slot(0).map(at), { scale: 0.92 })];
  if (tagFit) parts.push(enter(textPart(id('tagline'), tagline, 0, ys[1], { fontSize: tagFit.fontSize, maxWidth: area, fontWeight: 500, color: 'text2' }), slot(1).map(at), { dy: 24 * u }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a closing card: your logo, then a tagline under it',
  params,
  describe: {
    src: 'the logo file (PNG, JPG or SVG), relative to the spec file, like an image src',
    tagline: 'one line under the logo',
    width: 'the logo box width in px, 40 to 1600 (at most the safe area); the logo is fitted into a box half as tall',
  },
  example: { src: 'logo.svg', tagline: 'Motion from one JSON file' },
  place: (size) => ({ x: size[0] / 2, y: size[1] / 2 }),
  assets: ['src'],
  expand,
});
